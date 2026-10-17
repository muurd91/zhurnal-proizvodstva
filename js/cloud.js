// ================= Синхронизация с Firebase (Firestore) =================
// Адаптер к DB (data.js): держит копию данных в Firestore рядом с локальной.
// Локальная копия остаётся главной для работы — без сети приложение пишет в неё,
// а изменения уходят в облако, когда появляется связь.
//
// Все данные — один документ users/<uid>/apps/zhurnal: { json, updatedAt, rev, by }. Тот же проект и те же правила
// Firestore, что у «Табеля смены»: доступ только у владельца аккаунта (users/<uid>/**).
// json — строка с тем же документом, что лежит в localStorage (так обходим ограничения Firestore
// на вложенные массивы). Лимит Firestore на документ — 1 МБ.
//
// Вход — Firebase Auth через Google (тот же аккаунт, что в «Табеле»), сеанс держится на устройстве сам
// и не истекает раз в сутки.
// Запись — транзакция: читаем облачный документ, сливаем со своим (mergeDocs) и пишем. Если другое
// устройство успело записать раньше, транзакция сама повторится с новым состоянием.
// Изменения с других устройств приходят через onSnapshot, без опроса по таймеру.
//
// SDK лежит в js/vendor и кэшируется service worker'ом, чтобы приложение запускалось без сети.

const Cloud = (() => {
  const cfg = CONFIG.firebase || {};
  const KEY = 'jp.cloud';        // служебное состояние
  const KEY_BASE = 'jp.cloud.base'; // документ на момент последней успешной синхронизации

  // Работает по http(s) и только если SDK загрузился и в конфиге есть ключ.
  const available = /^https?:$/.test(location.protocol) && typeof firebase !== 'undefined' && !!cfg.app?.apiKey;

  const loadState = () => {
    try { return { pending: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { pending: 0 }; }
  };
  let st = loadState(); // { pending, rev, lastSync, account, needAuth }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  // База слияния — отличает «удалено» от «ещё не пришло» (см. mergeDocs). Сбрасывается при выходе.
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const loadBase = () => { try { return JSON.parse(localStorage.getItem(KEY_BASE) || 'null'); } catch { return null; } };
  let base = loadBase();
  const setBase = (doc) => {
    base = clone(doc);
    try { localStorage.setItem(KEY_BASE, JSON.stringify(base)); } catch {}
  };

  let auth = null, db = null, ref = null, unsubscribe = null;
  if (available) {
    firebase.initializeApp(cfg.app);
    auth = firebase.auth();
    db = firebase.firestore();
    db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); // за прокси и фильтрами обычный канал может не работать
  }

  let user = null;      // вошедший пользователь
  let ready = false;    // Firebase уже сообщил, вошли мы или нет
  let status = 'idle';  // 'idle' | 'syncing' | 'offline' | 'cloudError'
  let lastError = '';
  let running = false;
  let runPromise = null;
  let rerun = false;
  let overwrite = false; // следующая отправка заменяет облачный документ целиком (загрузка файла данных вручную)
  let timer = null;
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn());

  const connected = () => available && !!user;

  // ---------- Ошибки ----------
  // code: 'net' — нет связи; 'auth' — нужен новый вход; 'cloud' — остальное.
  const fail = (code, message = '') => Object.assign(new Error(message || code), { code });

  function mapError(e) {
    if (e?.code === 'net' || e?.code === 'auth' || e?.code === 'cloud') return e;
    const c = String(e?.code || '');
    if (c === 'unavailable' || c === 'deadline-exceeded' || c === 'cancelled' || c === 'auth/network-request-failed') return fail('net');
    if (c === 'unauthenticated' || c === 'auth/user-token-expired' || c === 'auth/requires-recent-login') return fail('auth');
    if (c === 'permission-denied') return fail('cloud', 'Нет доступа: войдите тем же Google-аккаунтом, что в «Табеле», либо проверьте правила Firestore.');
    if (c === 'resource-exhausted') return fail('cloud', 'Превышена квота Firebase. Данные сохранены на устройстве.');
    if (/maximum size|too large|exceeds/i.test(e?.message || '')) return fail('cloud', 'Данные не помещаются в один документ Firestore (лимит 1 МБ).');
    return fail('cloud', e?.message || 'Ошибка Firebase');
  }

  const SIGN_IN_ERRORS = {
    'auth/unauthorized-domain': 'Этот адрес не разрешён для входа: в консоли Firebase → Authentication → Settings → Authorized domains добавьте домен сайта.',
    'auth/operation-not-allowed': 'Вход через Google не включён: в консоли Firebase → Authentication → Sign-in method.',
    'auth/user-disabled': 'Этот аккаунт отключён.',
    'auth/network-request-failed': 'Нет связи с интернетом.',
  };

  async function signIn() {
    if (!available) return;
    lastError = '';
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      try { await auth.signInWithPopup(provider); }
      catch (e) {
        // Окно входа заблокировано (планшет, установленное приложение) — уходим на страницу Google и возвращаемся.
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await auth.signInWithRedirect(provider);
        } else throw e;
      }
    } catch (e) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      lastError = SIGN_IN_ERRORS[e.code] || e.message || 'Не удалось войти.';
      emit();
    }
  }

  function signOut() {
    base = null;
    try { localStorage.removeItem(KEY_BASE); } catch {}
    st = { pending: 0 };
    save();
    status = 'idle';
    lastError = '';
    clearTimeout(timer);
    stopListen();
    emit();
    ref = null;
    if (auth) auth.signOut();
  }

  // ---------- Слияние ----------
  // Каноничная строка: одинаковые по смыслу документы совпадают независимо от порядка ключей.
  const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]]))
    : v));

  // Трёхстороннее слияние. base — документ на момент последней успешной синхронизации (может быть null:
  // тогда записи только объединяются, удалений не видно).
  //  · запись есть в базе и пропала у одной из сторон — её удалили, удаление выигрывает
  //    (если вторая сторона успела её изменить — выигрывает правка);
  //  · запись изменена только на одной стороне — берём изменённую; на обеих — побеждает более новый документ;
  //  · запись новая (нет в базе) — добавляется.
  // Скалярные поля и вложенные объекты (смена, настройки) сливаются так же по целому значению.
  const same = (x, y) => canon(x) === canon(y);
  const keyOf = (item) => (item && item.id !== undefined ? `id:${item.id}` : `json:${canon(item)}`);

  function mergeList(L, R, B, localIsNewer) {
    const index = (list) => new Map(list.map((x) => [keyOf(x), x]));
    const lm = index(L), rm = index(R), bm = B ? index(B) : null;
    const order = localIsNewer ? [...L, ...R] : [...R, ...L]; // порядок — по главному документу
    const seen = new Set();
    const out = [];
    for (const item of order) {
      const k = keyOf(item);
      if (seen.has(k)) continue;
      seen.add(k);
      const l = lm.get(k), r = rm.get(k), bs = bm && bm.get(k);
      if (l && r) {
        if (bs && same(l, bs)) out.push(r);          // у нас не менялось — берём облачную
        else if (bs && same(r, bs)) out.push(l);     // в облаке не менялось — берём свою
        else out.push(localIsNewer ? l : r);
      } else if (l) {
        if (bs && same(l, bs)) continue;             // была в базе и не менялась, а в облаке исчезла — удалена там
        out.push(l);                                 // новая у нас (или правка против удаления)
      } else if (bs && same(r, bs)) continue;        // была в базе и не менялась, а у нас исчезла — удалена нами
      else out.push(r);                              // новая в облаке (или правка против удаления)
    }
    return out;
  }

  function mergeDocs(local, remote, baseDoc) {
    const localIsNewer = (local.updatedAt || '') > (remote.updatedAt || '');
    const newer = localIsNewer ? local : remote;
    const older = localIsNewer ? remote : local;
    const out = { ...newer, updatedAt: newer.updatedAt || older.updatedAt };
    const skip = new Set(['format', 'version', 'updatedAt']);
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      if (skip.has(key)) continue;
      const L = local[key], R = remote[key], B = baseDoc ? baseDoc[key] : undefined;
      if (Array.isArray(L) && Array.isArray(R)) {
        out[key] = mergeList(L, R, Array.isArray(B) ? B : null, localIsNewer);
      } else if (baseDoc && B !== undefined && same(L, B)) {
        out[key] = R;                                // у нас не менялось — берём облачное
      } else if (baseDoc && B !== undefined && same(R, B)) {
        out[key] = L;                                // в облаке не менялось — берём своё
      } else {
        out[key] = newer[key];
      }
    }
    return out;
  }

  // ---------- Облачный документ ----------
  function readDoc(data) {
    let raw;
    try { raw = JSON.parse(data.json); } catch { throw fail('cloud', 'Документ в облаке повреждён: не читается как JSON. Он не перезаписан.'); }
    try { return normalizeData(raw); } catch (e) { throw fail('cloud', `Документ в облаке не подходит: ${e.message} Он не перезаписан.`); }
  }

  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(fail('net')), ms)),
  ]);

  // ---------- Цикл синхронизации ----------
  async function runSync() {
    if (!navigator.onLine) throw fail('net');
    const sent = st.pending;
    const wasOverwrite = overwrite;
    // Снимок на момент отправки: пока идёт запись, документ могут изменить, и в базу должно попасть только ушедшее.
    const snap = clone(DB.data);

    const result = await withTimeout(ref.firestore.runTransaction(async (tx) => {
      const s = await tx.get(ref); // транзакция может выполниться повторно — внутри нет побочных действий
      const remote = s.exists ? readDoc(s.data()) : null;
      const doc = remote && !wasOverwrite ? mergeDocs(snap, remote, base) : snap;
      const push = wasOverwrite || !remote || canon(doc) !== canon(remote);
      let rev = s.exists ? (s.data().rev || 0) : 0;
      if (push) {
        rev += 1;
        tx.set(ref, { json: JSON.stringify(doc), updatedAt: doc.updatedAt || null, rev, by: user?.email || '' });
      }
      return { doc, rev };
    }), 20000);

    st.rev = result.rev;
    // Пока шла запись, документ могли изменить — свои новые правки не затираем, они уйдут следующим кругом.
    const cur = DB.data;
    const merged = same(cur, snap) ? result.doc : mergeDocs(cur, result.doc, snap);
    if (!same(merged, cur)) DB.applyRemote(merged);
    setBase(result.doc); // то, что сейчас в облаке, — новая база
    st.pending = Math.max(0, st.pending - sent);
    if (wasOverwrite) overwrite = false;
  }

  // Обещание выполняется, когда синхронизация закончилась (если уже идёт — дожидается её).
  function sync() {
    if (!connected()) return Promise.resolve();
    if (running) { rerun = true; return runPromise; }
    runPromise = doSync();
    return runPromise;
  }

  async function doSync() {
    running = true;
    status = 'syncing';
    emit();
    try {
      await runSync();
      status = 'idle';
      lastError = '';
      st.needAuth = false;
      st.lastSync = new Date().toISOString();
    } catch (raw) {
      const e = mapError(raw);
      if (e.code === 'auth') { st.needAuth = true; status = 'idle'; }
      else if (e.code === 'net') status = 'offline';
      else { status = 'cloudError'; lastError = e.message; }
    } finally {
      running = false;
      save();
      emit();
      if (rerun) { rerun = false; schedule(500); }
    }
  }

  function schedule(ms) {
    if (!connected()) return;
    clearTimeout(timer);
    timer = setTimeout(sync, ms);
  }

  // Живое слежение за документом: правки с других устройств приходят сразу, без опроса.
  function startListen() {
    stopListen();
    unsubscribe = ref.onSnapshot(
      (s) => {
        if (!s.exists || s.metadata.fromCache) return;
        if (s.data().rev === st.rev) return; // это наша же запись
        schedule(300);
      },
      (raw) => {
        const e = mapError(raw);
        if (e.code === 'cloud') { status = 'cloudError'; lastError = e.message; emit(); }
      },
    );
  }
  function stopListen() { if (unsubscribe) { unsubscribe(); unsubscribe = null; } }

  // DB сообщает о каждом локальном изменении.
  function localChange({ replaceAll = false } = {}) {
    if (!connected()) return;
    st.pending += 1;
    if (replaceAll) overwrite = true;
    save();
    emit();
    schedule(1500);
  }

  // ---------- Состояние для индикатора ----------
  function state() {
    if (!available) return null;
    if (!ready) return { cloud: true, at: st.lastSync, pending: st.pending, state: 'syncing' };
    if (!user) return { state: st.account ? 'auth' : 'local' };
    const b = { cloud: true, at: st.lastSync, pending: st.pending };
    if (st.needAuth) return { state: 'auth' };
    if (status === 'syncing' || (status === 'idle' && st.pending > 0)) return { ...b, state: 'syncing' };
    if (status === 'offline') return { ...b, state: 'offline' };
    if (status === 'cloudError') return { ...b, state: 'cloudError' };
    return { ...b, state: 'saved' };
  }

  const info = () => ({
    available,
    connected: connected(),
    needAuth: !!st.needAuth || (ready && !user && !!st.account),
    account: user?.email || st.account || '',
    lastSync: st.lastSync || null,
    pending: st.pending,
    error: lastError,
    project: cfg.app?.projectId || '',
  });

  function init() {
    if (!available) return;
    auth.onAuthStateChanged((u) => {
      user = u;
      ready = true;
      ref = u ? db.collection('users').doc(u.uid).collection('apps').doc('zhurnal') : null;
      if (u) {
        st.account = u.email || '';
        save();
        startListen();
        sync();
      } else {
        stopListen();
      }
      emit();
    });
    auth.getRedirectResult().catch((e) => { lastError = SIGN_IN_ERRORS[e.code] || e.message || 'Не удалось войти.'; emit(); });
    window.addEventListener('online', () => sync());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  }

  return {
    available,
    init,
    signIn,
    signOut,
    syncNow: () => { lastError = ''; return sync(); },
    localChange,
    state,
    info,
    onChange: (fn) => listeners.push(fn),
  };
})();

DB.attachSync(Cloud);
