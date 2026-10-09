// ================= Синхронизация с OneDrive =================
// Адаптер к DB (data.js): держит файл данных в OneDrive рядом с локальной копией.
// Локальная копия остаётся главной для работы — без сети приложение пишет в неё,
// а изменения уходят в OneDrive, когда появляется связь.
//
// Вход — OAuth 2.0 «код авторизации + PKCE» (Microsoft Entra, регистрация типа SPA),
// без сторонних библиотек. Доступ к файлу — Microsoft Graph, путь вида
//   /me/drive/root:/<папка>/<файл>
// Параллельные правки с двух устройств сверяются по ETag файла; при расхождении
// документы сливаются по id записей (см. mergeDocs).
//
// Ограничение Microsoft для SPA: refresh-токен живёт ~24 часа, потом нужен повторный вход.
// До входа данные копятся локально и ничего не теряется.

const OneDrive = (() => {
  const cfg = CONFIG.onedrive || {};
  const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const SCOPES = 'Files.ReadWrite User.Read offline_access';
  const KEY = 'jp.od';        // токены и служебное состояние
  const KEY_AUTH = 'jp.od.auth'; // verifier/state на время перехода на страницу входа

  // Работает только по http(s) в защищённом контексте (нужен crypto.subtle) и с заданным clientId.
  const available = /^https?:$/.test(location.protocol) && window.isSecureContext && !!window.crypto?.subtle && !!cfg.clientId;

  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

  const loadState = () => {
    try { return { pending: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { pending: 0 }; }
  };
  let st = loadState(); // { refresh, access, expires, etag, account, lastSync, pending, needAuth }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  let status = 'idle'; // 'idle' | 'syncing' | 'offline' | 'cloudError'
  let lastError = '';
  let running = false;
  let runPromise = null;
  let rerun = false;
  let overwrite = false; // следующая отправка заменяет файл целиком (загрузка файла данных вручную)
  let timer = null;
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn());

  const connected = () => available && !!st.refresh;

  // ---------- Ошибки ----------
  // code: 'net' — нет связи или сервер временно недоступен; 'auth' — нужен новый вход; 'cloud' — остальное.
  const fail = (code, message = '') => Object.assign(new Error(message || code), { code });

  // ---------- Вход (PKCE) ----------
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

  async function signIn() {
    if (!available) return;
    const verifier = randomString(48);
    const state = randomString(16);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    try { localStorage.setItem(KEY_AUTH, JSON.stringify({ verifier, state })); } catch {}
    const q = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    location.assign(`${AUTH}/authorize?${q}`);
  }

  // Возврат со страницы входа: в адресе приходит ?code=…&state=… (или ?error=…).
  async function completeSignIn() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    const r = { code: q.get('code'), state: q.get('state'), error: q.get('error'), description: q.get('error_description') };
    let auth = null;
    try { auth = JSON.parse(localStorage.getItem(KEY_AUTH) || 'null'); localStorage.removeItem(KEY_AUTH); } catch {}
    const p = new URLSearchParams(location.search);
    ['code', 'state', 'session_state', 'error', 'error_description', 'client_info'].forEach((k) => p.delete(k));
    const rest = p.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);

    if (r.error) { status = 'cloudError'; lastError = r.description || r.error; return; }
    if (!auth || auth.state !== r.state) { status = 'cloudError'; lastError = 'Вход не завершён: не совпал код проверки. Попробуйте ещё раз.'; return; }
    try {
      await tokenRequest({ grant_type: 'authorization_code', code: r.code, redirect_uri: redirectUri(), code_verifier: auth.verifier });
      st.needAuth = false;
      st.etag = null; // новый вход — сверяем с файлом заново
      save();
      loadAccount();
    } catch (e) {
      status = 'cloudError';
      lastError = e.message;
    }
  }

  let tokenPromise = null;
  function tokenRequest(params) {
    const run = async () => {
      let res;
      try {
        res = await fetch(`${AUTH}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: cfg.clientId, scope: SCOPES, ...params }),
        });
      } catch { throw fail('net'); }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const needLogin = j.error === 'invalid_grant' || j.error === 'interaction_required' || res.status === 401;
        throw fail(needLogin ? 'auth' : res.status >= 500 ? 'net' : 'cloud', j.error_description || j.error || `Ошибка входа (${res.status})`);
      }
      st.access = j.access_token;
      st.expires = Date.now() + (j.expires_in || 3600) * 1000;
      if (j.refresh_token) st.refresh = j.refresh_token;
      save();
    };
    // Параллельные обновления токена сливаем в одно: refresh-токен одноразовый.
    if (params.grant_type === 'refresh_token') {
      tokenPromise ||= run().finally(() => { tokenPromise = null; });
      return tokenPromise;
    }
    return run();
  }

  async function accessToken() {
    if (st.access && st.expires > Date.now() + 60000) return st.access;
    if (!st.refresh) throw fail('auth');
    await tokenRequest({ grant_type: 'refresh_token', refresh_token: st.refresh });
    return st.access;
  }

  function signOut() {
    st = { pending: 0 };
    save();
    status = 'idle';
    lastError = '';
    clearTimeout(timer);
    emit();
  }

  // ---------- Graph ----------
  const enc = (s) => s.split('/').map(encodeURIComponent).join('/');
  const fileUrl = () => `${GRAPH}/me/drive/root:/${enc(cfg.folder)}/${encodeURIComponent(cfg.file)}`;

  async function api(url, opts = {}, retry = true) {
    const token = await accessToken();
    let res;
    try { res = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } }); }
    catch { throw fail('net'); }
    if (res.status === 401) {
      if (!retry) throw fail('auth');
      st.access = null;
      return api(url, opts, false);
    }
    if (res.status >= 500 || res.status === 429 || res.status === 408) throw fail('net', `OneDrive временно недоступен (${res.status})`);
    return res;
  }

  async function cloudMessage(res) {
    const j = await res.json().catch(() => null);
    return j?.error?.message || `Ошибка OneDrive (${res.status})`;
  }

  async function getMeta() {
    const res = await api(fileUrl());
    if (res.status === 404) return null;
    if (!res.ok) throw fail('cloud', await cloudMessage(res));
    return res.json();
  }

  async function download() {
    const res = await api(`${fileUrl()}:/content`);
    if (!res.ok) throw fail('cloud', await cloudMessage(res));
    let raw;
    try { raw = JSON.parse(await res.text()); } catch { throw fail('cloud', 'Файл в OneDrive повреждён: не читается как JSON. Он не перезаписан.'); }
    try { return normalizeData(raw); } catch (e) { throw fail('cloud', `Файл в OneDrive не подходит: ${e.message} Он не перезаписан.`); }
  }

  // null — файл изменился с момента чтения (нужно сверить заново).
  async function upload(doc, etag) {
    const url = `${fileUrl()}:/content` + (etag ? '' : '?@microsoft.graph.conflictBehavior=fail');
    const res = await api(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
      body: JSON.stringify(doc, null, 2),
    });
    if (res.status === 412 || res.status === 409) return null;
    if (!res.ok) throw fail('cloud', await cloudMessage(res));
    return res.json();
  }

  async function loadAccount() {
    try {
      const res = await api(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`);
      if (!res.ok) return;
      const j = await res.json();
      st.account = j.mail || j.userPrincipalName || j.displayName || '';
      save();
      emit();
    } catch {}
  }

  // ---------- Слияние ----------
  // Каноничная строка: одинаковые по смыслу документы совпадают независимо от порядка ключей.
  const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]]))
    : v));

  // Документ, изменённый позже, главный: его значения и порядок записей. Записи другого документа,
  // которых нет в главном (по id), добавляются в конец. Оговорка: запись, удалённая на одном
  // устройстве, может вернуться, если за это время файл правило другое устройство.
  function mergeDocs(local, remote) {
    const newer = (local.updatedAt || '') > (remote.updatedAt || '') ? local : remote;
    const older = newer === local ? remote : local;
    const out = { ...newer, updatedAt: newer.updatedAt || older.updatedAt };
    const keyOf = (item) => (item && item.id !== undefined ? `id:${item.id}` : `json:${canon(item)}`);
    for (const key of Object.keys(emptyData())) {
      if (!Array.isArray(newer[key]) || !Array.isArray(older[key])) continue;
      const seen = new Set(newer[key].map(keyOf));
      out[key] = [...newer[key], ...older[key].filter((item) => !seen.has(keyOf(item)))];
    }
    return out;
  }

  // ---------- Цикл синхронизации ----------
  async function runSync() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const meta = await getMeta(); // null — файла ещё нет
      let doc = DB.data;
      let remote = null;
      if (meta && !overwrite && meta.eTag !== st.etag) {
        remote = await download();
        doc = mergeDocs(DB.data, remote);
        if (canon(doc) !== canon(DB.data)) DB.applyRemote(doc);
      }
      const needPush = overwrite || !meta || st.pending > 0 || (remote && canon(doc) !== canon(remote));
      if (!needPush) { st.etag = meta.eTag; return; }

      const sent = st.pending;
      const wasOverwrite = overwrite;
      const res = await upload(doc, meta ? meta.eTag : null);
      if (res) {
        st.etag = res.eTag;
        st.pending = Math.max(0, st.pending - sent);
        if (wasOverwrite) overwrite = false;
        return;
      }
    }
    throw fail('cloud', 'Не удалось согласовать изменения с другим устройством. Попробуйте ещё раз.');
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
      st.lastSync = new Date().toISOString();
      if (!st.account) loadAccount();
    } catch (e) {
      if (e.code === 'auth') { st.refresh = null; st.access = null; st.needAuth = true; status = 'idle'; }
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
    if (!st.refresh) return { state: st.needAuth ? 'auth' : 'local' };
    const base = { cloud: true, at: st.lastSync, pending: st.pending };
    if (status === 'syncing' || (status === 'idle' && st.pending > 0)) return { ...base, state: 'syncing' };
    if (status === 'offline') return { ...base, state: 'offline' };
    if (status === 'cloudError') return { ...base, state: 'cloudError' };
    return { ...base, state: 'saved' };
  }

  const info = () => ({
    available,
    connected: connected(),
    needAuth: !!st.needAuth,
    account: st.account || '',
    lastSync: st.lastSync || null,
    pending: st.pending,
    error: status === 'cloudError' ? lastError : (!connected() && lastError ? lastError : ''),
    path: `${cfg.folder}/${cfg.file}`,
  });

  function init() {
    if (!available) return;
    // Если вход проходил с ошибкой, текст остаётся в lastError до следующей попытки.
    completeSignIn().finally(() => {
      emit();
      if (connected()) sync();
    });
    setInterval(() => { if (!document.hidden) sync(); }, (cfg.pollSeconds || 45) * 1000);
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

DB.attachSync(OneDrive);
