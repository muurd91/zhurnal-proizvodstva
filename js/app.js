// ================= Настройки устройства =================
// Только то, что относится к конкретному планшету/ПК (например, открытая вкладка).
// Рабочие данные — в файле данных, см. data.js.
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('jp.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('jp.' + key, JSON.stringify(value)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem('jp.' + key); } catch {}
  },
};

const state = {
  tab: store.get('tab', 'current'),
  eqPeriod: store.get('eqPeriod', '30'), // период статистики в перечне оборудования
  historyLimit: 20,                      // сколько смен показано в истории
  eqOpen: new Set(),                     // раскрытые строки в перечне оборудования
  histOpen: new Set(),                   // раскрытые смены в истории (не сохраняется)
  histSeeded: new Set(),                 // смены, которым уже выставили раскрытие по умолчанию
  admin: false,                     // режим настроек: переживает обновление страницы, но не закрытие приложения
  editing: false,                   // редактирование текущей вкладки (только в режиме настроек)
  viewer: store.get('viewer', false), // режим зрителя: только просмотр, запоминается на устройстве
};

const $ = (sel) => document.querySelector(sel);
const OTHER = '__other__';

// Идентификатор этого устройства. Смену ведут только с того устройства, где её начали;
// остальные видят её как зрители. Смена без deviceId (начата старой версией) доступна всем.
const DEVICE_ID = (() => {
  let id = store.get('device', null);
  if (!id) { id = uid(); store.set('device', id); }
  return id;
})();
const canControl = (shift) => !shift || !shift.deviceId || shift.deviceId === DEVICE_ID;

// Данные смен (мастера, номера, время) — из файла данных, меняются во вкладке «Данные смен».
const SETTINGS = () => DB.data.settings;

// ================= Время =================
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function atTime(base, hhmm, dayOffset = 0) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

// Плановое начало смены данного типа, ближайшее к текущему моменту.
function plannedStart(type, now = new Date()) {
  const { start } = SETTINGS().shiftTypes[type];
  return [-1, 0, 1]
    .map((off) => atTime(now, start, off))
    .reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
}

function plannedEnd(type, startDate) {
  const end = atTime(startDate, SETTINGS().shiftTypes[type].end);
  if (end <= startDate) end.setDate(end.getDate() + 1);
  return end;
}

// Какая смена идёт сейчас по расписанию.
function currentShiftType(now = new Date()) {
  for (const type of Object.keys(SETTINGS().shiftTypes)) {
    const s = plannedStart(type, now);
    if (s <= now && now < plannedEnd(type, s)) return type;
  }
  return Object.keys(SETTINGS().shiftTypes)[0];
}

// ================= Экран начала смены =================
let formType = currentShiftType();

// Если смена уже идёт (начата на другом устройстве), вместо «Заступить» — «Продолжить смену».
function showStartScreen() {
  $('#screen-main').hidden = true;
  $('#screen-start').hidden = false;
  $('#start-step-1').hidden = false;
  $('#start-step-2').hidden = true;
  document.body.classList.remove('is-viewer');
  renderStartRunning();
  refreshStartScreen();
}

// «Идёт дневная смена № 1 · мастер Иванов». На чужом устройстве кнопка остаётся «Заступить»: нажатие даёт ошибку.
function renderStartRunning() {
  const shift = DB.data.currentShift;
  const mine = shift && canControl(shift);
  $('#btn-take-shift').textContent = mine ? 'Продолжить смену' : 'Заступить на смену';
  $('#start-running').hidden = !shift;
  if (shift) {
    $('#start-running').innerHTML = `Идёт ${shiftTitle(shift).toLowerCase()} · мастер <b>${escapeHtml(shift.master)}</b>` +
      (mine ? '' : '<br><span class="muted">начата на другом устройстве</span>');
  }
}

// Смена по расписанию и стоящие станки на стартовом экране; часы — в tickClock.
function refreshStartScreen() {
  if ($('#screen-start').hidden) return;
  const type = currentShiftType();
  const t = SETTINGS().shiftTypes[type];
  $('#start-schedule').innerHTML = `Сейчас по расписанию: <b>${t.label.toLowerCase()}</b>, ${t.start}–${t.end}`;
  const down = openBreakdowns().size;
  $('#start-down').hidden = !down;
  $('#start-down').textContent = `■ Стоят: ${down}`;
}

function openShiftForm() {
  const sel = $('#f-master');
  sel.innerHTML =
    '<option value="" disabled selected>Выберите из списка</option>' +
    SETTINGS().masters.map((m) =>
      `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}${m.number ? ` · смена № ${escapeHtml(m.number)}` : ''}</option>`).join('') +
    `<option value="${OTHER}">Другое…</option>`;
  $('#f-master-other').value = '';
  $('#f-master-other-wrap').hidden = true;

  const numbers = SETTINGS().shiftNumbers;
  $('#f-number-wrap').hidden = !numbers.length;
  $('#f-number').required = numbers.length > 0;
  $('#f-number').innerHTML = '<option value="" disabled selected>Выберите номер</option>' +
    numbers.map((n) => `<option>${escapeHtml(n)}</option>`).join('');

  formType = currentShiftType();
  renderTypeSwitch();

  $('#start-step-1').hidden = true;
  $('#start-step-2').hidden = false;
}

function renderTypeSwitch() {
  $('#f-type').innerHTML = Object.entries(SETTINGS().shiftTypes)
    .map(([id, t]) =>
      `<button type="button" class="segmented__btn${id === formType ? ' is-active' : ''}" data-type="${id}">${t.label}</button>`)
    .join('');
  const s = plannedStart(formType);
  $('#f-start').textContent = `${fmtDate(s)}, ${fmtTime(s)}`;
}

// Перед стартом подтягиваем свежие данные из OneDrive, чтобы не пропустить смену, начатую на другом устройстве.
// Нет связи — работаем с тем, что есть на устройстве: смену на планшете нужно уметь начать и без сети.
async function freshen() {
  if (!OneDrive.info().connected) return;
  await Promise.race([OneDrive.syncNow(), new Promise((resolve) => setTimeout(resolve, 5000))]);
}

// Ошибка: смена идёт на другом устройстве. Выход — режим зрителя (или «Забрать смену» по паролю).
function showBusyError(shift, title = 'Смена уже идёт на другом устройстве') {
  openModal(title, `
    <p>Сейчас идёт <b>${escapeHtml(shiftTitle(shift).toLowerCase())}</b>, мастер <b>${escapeHtml(shift.master)}</b>.
       Начать вторую смену нельзя: её ведут только с того устройства, где она начата.</p>
    <p class="muted">Вы можете открыть журнал в режиме зрителя.</p>`, [
    { label: 'Закрыть' },
    { label: 'Забрать смену', danger: true, onClick: () => { openTakeover(); return false; } },
    { label: 'Режим зрителя', primary: true, onClick: () => setViewer(true) },
  ]);
}

// Запасной выход, если устройство со сменой недоступно (сломано, потеряно): смена переходит на это устройство.
function openTakeover() {
  openModal('Забрать смену на это устройство?', `
    <p>Используйте, только если устройство, где начата смена, недоступно. Смена продолжится здесь со всеми записями,
       а на прежнем устройстве станет доступна только для просмотра.</p>
    <label class="field"><span class="field__label">Логин</span><input id="m-login" autocomplete="off"></label>
    <label class="field"><span class="field__label">Пароль</span><input id="m-pass" type="password"></label>
    <p class="error" id="m-error" hidden>Неверный логин или пароль</p>`, [
    { label: 'Отмена' },
    {
      label: 'Забрать',
      danger: true,
      onClick: () => {
        const ok = $('#m-login').value === CONFIG.admin.login && $('#m-pass').value === CONFIG.admin.password;
        if (!ok) { $('#m-error').hidden = false; return false; }
        setJoined(true);
        DB.update((d) => { if (d.currentShift) d.currentShift.deviceId = DEVICE_ID; });
      },
    },
  ]);
  $('#m-login').focus();
}

$('#btn-take-shift').addEventListener('click', async () => {
  const btn = $('#btn-take-shift');
  btn.disabled = true;
  try { await freshen(); } finally { btn.disabled = false; }
  const shift = DB.data.currentShift;
  renderStartRunning();
  if (!shift) return openShiftForm();
  if (!canControl(shift)) return showBusyError(shift);
  setJoined(true);
  renderApp();
});
$('#btn-back').addEventListener('click', showStartScreen);

$('#f-master').addEventListener('change', (e) => {
  const other = e.target.value === OTHER;
  $('#f-master-other-wrap').hidden = !other;
  $('#f-master-other').required = other;
  if (other) $('#f-master-other').focus();
  // Номер смены — по привязке мастера (можно поменять вручную, например при подмене).
  const bound = SETTINGS().masters.find((m) => m.name === e.target.value)?.number;
  if (bound && SETTINGS().shiftNumbers.includes(bound)) $('#f-number').value = bound;
});

$('#f-type').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  formType = btn.dataset.type;
  renderTypeSwitch();
});

$('#start-step-2').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sel = $('#f-master').value;
  const master = sel === OTHER ? $('#f-master-other').value.trim() : sel;
  if (!master) return;
  const number = $('#f-number').value || '';
  if (SETTINGS().shiftNumbers.length && !number) return;
  // Пока заполняли форму, смену могли начать на другом устройстве.
  await freshen();
  const running = DB.data.currentShift;
  if (running) {
    showStartScreen();
    if (!canControl(running)) showBusyError(running);
    return;
  }
  const start = plannedStart(formType);
  setJoined(true);
  DB.update((d) => {
    // Плановый конец фиксируем при старте: правка расписания не должна сдвигать уже идущую смену.
    d.currentShift = {
      id: uid(), deviceId: DEVICE_ID, master, number, type: formType,
      start: start.toISOString(),
      plannedEnd: plannedEnd(formType, start).toISOString(),
    };
  });
});

// ================= Основное окно =================
function showMainScreen() {
  $('#screen-start').hidden = true;
  $('#screen-main').hidden = false;
  document.body.classList.toggle('is-viewer', state.viewer);
  $('#btn-end-shift').textContent = state.viewer ? 'Выйти из просмотра' : 'Закончить смену';
  renderShiftInfo();
  renderSaveStatus();
  renderNav();
  renderTab();
}

let lastMinute = -1;
function tickClock() {
  const d = new Date();
  $('#clock-time').textContent = fmtTime(d);
  $('#clock-date').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  $('#clock-weekday').textContent = WEEKDAYS[d.getDay()];
  $('#start-time').textContent = fmtTime(d);
  $('#start-date').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}`;
  if (d.getMinutes() !== lastMinute) {
    lastMinute = d.getMinutes();
    refreshTimers();
    applyTheme(); // в 20:00 и 08:00 тема «Авто» переключается сама
  }
}

// Таймеры простоя обновляются на месте, без перерисовки вкладки (работает и при открытом окне).
// data-since — начало остановки; data-shift-downtime — простой за текущую смену.
function refreshTimers() {
  if (!DB.data) return;
  document.querySelectorAll('[data-since]').forEach((el) => {
    el.textContent = fmtDuration(Date.now() - new Date(el.dataset.since));
  });
  const shift = DB.data.currentShift;
  if (shift) {
    const total = fmtDuration(shiftBreakdowns(shift, new Date()).downtime);
    document.querySelectorAll('[data-shift-downtime]').forEach((el) => { el.textContent = total; });
  }
  // «осталось …» у идущей смены в истории
  document.querySelectorAll('[data-shift-left]').forEach((el) => { el.textContent = shiftLeftText(new Date(el.dataset.shiftLeft)); });
  refreshShiftProgress();
  refreshStartScreen();
}

// «04:12», «вчера 22:40» или «05.10 14:03» — без полной даты для недавних событий.
function fmtWhen(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return fmtTime(d);
  if (diff === 1) return `вчера ${fmtTime(d)}`;
  return `${fmtDate(d).slice(0, 5)} ${fmtTime(d)}`;
}

// Индикатор сохранения: память устройства (saved / error) и OneDrive (local, auth, syncing, offline, cloudError).
// Нажатие на индикатор открывает окно подключения OneDrive.
const SAVE_LABELS = {
  saved:      (s) => (s.cloud ? `OneDrive${s.at ? ` · ${fmtWhen(s.at)}` : ''}` : s.at ? `Сохранено · ${fmtWhen(s.at)}` : 'Сохранено'),
  syncing:    () => 'Синхронизация…',
  offline:    (s) => `Офлайн, ${s.pending} ${plural(s.pending, 'изменение', 'изменения', 'изменений')}`,
  error:      () => 'Не сохранено',
  local:      () => 'Только на устройстве',
  auth:       () => 'Войдите в OneDrive',
  cloudError: () => 'Ошибка OneDrive',
};
const SAVE_TITLES = {
  saved:      (s) => (s.cloud ? 'Изменения записаны на устройстве и в OneDrive' : 'Все изменения записаны на этом устройстве'),
  syncing:    () => 'Изменения отправляются в OneDrive',
  offline:    () => 'Нет связи с OneDrive. Изменения сохранены на устройстве и уйдут, когда появится сеть',
  error:      () => 'Последнее изменение не удалось записать в память устройства',
  local:      () => 'Данные хранятся только на этом устройстве. Нажмите, чтобы подключить OneDrive',
  auth:       () => 'Нужно войти в OneDrive заново. Изменения пока сохраняются на устройстве',
  cloudError: () => 'OneDrive вернул ошибку. Нажмите, чтобы посмотреть',
};
function renderSaveStatus() {
  const s = DB.saveState;
  const el = $('#save-status');
  el.className = `save-status save-status--${s.state}`;
  el.textContent = SAVE_LABELS[s.state](s);
  el.title = SAVE_TITLES[s.state](s);
}

function openCloudModal() {
  const i = OneDrive.info();
  const err = i.error ? `<p class="od-error">${escapeHtml(i.error)}</p>` : '';
  const path = `<b>${escapeHtml(i.path)}</b>`;
  if (!i.available) {
    openModal('OneDrive', '<p>Синхронизация работает, когда приложение открыто по адресу сайта (https). Из файла на диске она недоступна.</p>',
      [{ label: 'Закрыть', primary: true }]);
    return;
  }
  if (!i.connected) {
    openModal('OneDrive', `
      <p>${i.needAuth ? 'Сеанс входа истёк — войдите заново.' : 'Данные сейчас хранятся только на этом устройстве.'}
         Войдите в аккаунт Microsoft, и журнал будет сохраняться в OneDrive (${path}) и станет общим для всех устройств.</p>
      <p class="muted">Пока вы не вошли, изменения сохраняются на устройстве и ничего не теряется.</p>${err}`, [
      { label: 'Позже' },
      { label: 'Войти в OneDrive', primary: true, onClick: () => { OneDrive.signIn(); return false; } },
    ]);
    return;
  }
  const last = i.lastSync ? `${fmtDate(new Date(i.lastSync))} ${fmtTime(new Date(i.lastSync))}` : 'ещё не было';
  openModal('OneDrive', `
    <p>Подключено${i.account ? `: <b>${escapeHtml(i.account)}</b>` : ''}.</p>
    <p class="muted">Файл: ${path}<br>
      Последняя синхронизация: ${last}<br>
      Ждёт отправки: ${i.pending}</p>${err}
    <p class="muted">«Отключить» не удаляет данные ни на устройстве, ни в OneDrive.</p>`, [
    { label: 'Отключить', danger: true, onClick: () => OneDrive.signOut() },
    { label: 'Закрыть' },
    { label: 'Синхронизировать', primary: true, onClick: () => OneDrive.syncNow() },
  ]);
}
$('#save-status').addEventListener('click', openCloudModal);
$('#save-status').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCloudModal(); }
});

function renderShiftInfo() {
  const shift = DB.data.currentShift;
  const viewerTag = state.viewer ? '<span class="viewer-tag">Режим зрителя</span>' : '';
  if (!shift) {
    $('#shift-info').innerHTML = `${viewerTag}<div class="info__type">Смена не начата</div>`;
    return;
  }
  const { master } = shift;
  const { start, end } = shiftBounds(shift);
  // Дату не повторяем — она есть в часах слева.
  $('#shift-info').innerHTML = `
    ${viewerTag}
    <div class="info__type">${shiftTitle(shift)}</div>
    <div class="info__row">Мастер: <b>${escapeHtml(master)}</b> · ${fmtTime(start)}–${fmtTime(end)}</div>
    <div class="info__progress" aria-hidden="true"><span class="info__bar" id="shift-bar"></span></div>
    <div class="info__left" id="shift-left"></div>`;
  refreshShiftProgress();
}

const shiftBounds = (shift) => {
  const start = new Date(shift.start);
  return { start, end: shift.plannedEnd ? new Date(shift.plannedEnd) : plannedEnd(shift.type, start) };
};

// Полоса прогресса смены и «осталось …» / «сверх плана …». Обновляется раз в минуту вместе с таймерами.
function refreshShiftProgress() {
  const shift = DB.data.currentShift;
  const bar = $('#shift-bar'), left = $('#shift-left');
  if (!shift || !bar) return;
  const { start, end } = shiftBounds(shift);
  const now = Date.now();
  const over = now > end;
  bar.style.width = `${over ? 100 : Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))}%`;
  left.classList.toggle('is-over', over);
  left.textContent = over ? `сверх плана ${fmtDuration(now - end)}` : `осталось ${fmtDuration(end - now)}`;
}

// «Дневная смена № 2»
const shiftTitle = (sh) =>
  `${SETTINGS().shiftTypes[sh.type]?.label || ''} смена${sh.number ? ` № ${escapeHtml(sh.number)}` : ''}`;

// Обычные вкладки + вкладки режима настроек.
const visibleTabs = () => (state.admin ? [...CONFIG.tabs, ...CONFIG.adminTabs] : CONFIG.tabs);

const ALERT_TITLES = {
  current: (n) => `${n} ${plural(n, 'станок стоит', 'станка стоят', 'станков стоят')}`,
  repair: (n) => `${n} ${plural(n, 'открытая заявка', 'открытые заявки', 'открытых заявок')} на ремонт`,
  warehouse: (n) => `${n} ${plural(n, 'позиция', 'позиции', 'позиций')} ниже минимального остатка`,
};

function renderNav() {
  const badges = getBadges();
  $('#nav-tabs').innerHTML = visibleTabs()
    .map((t) => {
      const badge = badges[t.id];
      const cls = `tab${t.id === state.tab ? ' is-active' : ''}${CONFIG.adminTabs.includes(t) ? ' tab--admin' : ''}`;
      const title = badge ? `${t.title}: ${ALERT_TITLES[t.id](badge.count)}` : t.title;
      return `
      <button class="${cls}" data-tab="${t.id}" title="${title}">
        <span class="tab__icon">${ICONS[t.icon]}</span>
        <span class="tab__label">${t.label}</span>
        ${badge ? `<span class="tab__badge tab__badge--${badge.tone}">${badge.count}</span>` : ''}
      </button>`;
    })
    .join('');
}

// Счётчики на вкладках. Красный — только стоящие станки (авария); жёлтый — требует внимания:
// открытые заявки на ремонт и запчасти ниже минимума.
function getBadges() {
  const { repairs, parts } = DB.data;
  const down = openBreakdowns().size;
  const open = repairs.filter((r) => r.status !== 'done').length;
  const low = parts.filter(isLow).length;
  return {
    current: down ? { tone: 'red', count: down } : null,
    repair: open ? { tone: 'yellow', count: open } : null,
    warehouse: low ? { tone: 'yellow', count: low } : null,
  };
}

// Переход на вкладку (из меню или по ссылке внутри панели).
function goTab(id) {
  state.tab = id;
  state.editing = false;
  store.set('tab', state.tab);
  renderNav();
  renderTab();
}

$('#nav-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  goTab(btn.dataset.tab);
});

// Заглушки содержимого вкладок — наполним на следующих шагах.
const TAB_STUBS = {
  current:   'Состояние оборудования в текущей смене.',
  history:   'Все смены по порядку и поломки в каждой из них.',
  equipment: 'Оборудование по подгруппам с историей поломок.',
  repair:    'Заявки на необходимый ремонт оборудования.',
  warehouse: 'Склад запчастей с контролем минимального остатка.',
  manuals:   'Сборник мануалов на оборудование.',
};

const FAB_TITLES = {
  current: 'Записать остановку станка',
  repair: 'Новая заявка на ремонт',
  warehouse: 'Добавить запчасть на склад',
};

// Что можно менять во вкладке в режиме настроек.
const EDIT_HINTS = {
  current:   'Редактирование и удаление поломок.',
  history:   'Редактирование и удаление поломок и смен.',
  equipment: 'Добавление и редактирование подгрупп и оборудования.',
  repair:    'Редактирование и удаление заявок.',
  warehouse: 'Редактирование подгрупп и типов запчастей.',
  manuals:   'Добавление и удаление мануалов.',
};

function renderTab() {
  const tab = visibleTabs().find((t) => t.id === state.tab) || CONFIG.tabs[0];
  const editing = state.admin && state.editing;
  const body = TAB_VIEWS[tab.id] ? TAB_VIEWS[tab.id]() : `
    <div class="empty">
      <div class="empty__icon">${ICONS[tab.icon]}</div>
      <p>${TAB_STUBS[tab.id]}</p>
      <p class="muted">Раздел в разработке</p>
    </div>`;
  // На «Смене» заголовок не нужен: он дублирует вкладку и шапку.
  $('#panel').innerHTML = `
    ${tab.id === 'current' ? '' : `<h2 class="panel__title">${tab.title}</h2>`}
    ${state.admin ? `<div class="panel__admin">Режим настроек${editing ? ` · ${EDIT_HINTS[tab.id]}` : ''}</div>` : ''}
    ${body}`;

  const fab = $('#fab');
  // Склад пополняется только в режиме настроек.
  fab.hidden = !tab.fab || (tab.id === 'warehouse' && !state.admin);
  if (tab.fab) {
    fab.innerHTML = `<span class="fab__icon">${ICONS.add}</span><span class="fab__label">${tab.fab}</span>`;
    fab.title = FAB_TITLES[tab.id];
  }

  const edit = $('#btn-edit');
  edit.hidden = !state.admin || tab.id === 'shifts' || tab.id === 'manuals';
  edit.classList.toggle('is-active', editing);
  edit.querySelector('.edit-btn__label').textContent = edit.title = editing ? 'Готово' : 'Редактировать';
}

$('#btn-edit').addEventListener('click', () => {
  // В перечне оборудования кнопка сразу открывает окно внесения данных.
  if (state.tab === 'equipment') return openEquipmentForm();
  state.editing = !state.editing;
  renderTab();
});

// ================= Перечень оборудования =================
// Запись: { id, group, name, mark, inv, pos }
const getEquipment = () => DB.data.equipment;
// Группы — в порядке внесения в перечень (так, как их заводили на производстве), везде одинаково.
const getGroups = () => [...new Set(getEquipment().map((e) => e.group))];
// Станки внутри группы: по позиции в цеху (без позиции — в конце), затем по имени («№2» раньше «№10»).
const byPos = (a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity) || a.name.localeCompare(b.name, 'ru', { numeric: true });

function equipmentView() {
  const list = getEquipment();
  if (!list.length) {
    return `
      <div class="empty">
        <div class="empty__icon">${ICONS.equipment}</div>
        <p>Оборудование ещё не добавлено.</p>
        <p class="muted">${state.admin ? 'Нажмите «Редактировать», чтобы внести первое оборудование.' : 'Добавить его можно в режиме настроек.'}</p>
      </div>`;
  }
  const from = periodStart();
  const stats = new Map(list.map((e) => [e.id, eqStats(e.id, from)]));
  const all = [...stats.values()];
  const broken = all.filter((s) => s.inRepair).length;

  const tiles = `
    <div class="stat-row">
      ${statTile('Работает', `${list.length - broken} из ${list.length}`)}
      ${statTile('В ремонте', broken, broken ? 'bad' : '')}
      ${statTile(`Поломок · ${periodLabel()}`, all.reduce((n, s) => n + s.count, 0))}
      ${statTile(`Простой · ${periodLabel()}`, fmtDuration(all.reduce((n, s) => n + s.downtime, 0)))}
    </div>`;

  // Внутри подгруппы: сначала то, что в ремонте, потом самые проблемные.
  const order = (a, b) => {
    const sa = stats.get(a.id), sb = stats.get(b.id);
    return (sb.inRepair ? 1 : 0) - (sa.inRepair ? 1 : 0) || sb.downtime - sa.downtime || byPos(a, b);
  };

  // Заголовки колонок — первой строкой в карточке каждой группы.
  const head = `
    <div class="eq-head">
      <span>Оборудование</span><span>Состояние</span><span>Поломок</span><span>Простой</span><span>Последняя</span><span></span>
    </div>`;

  return periodSwitch() + tiles + getGroups().map((g) => `
    <section class="eq-group">
      <h3 class="eq-group__title">${escapeHtml(g)}</h3>
      <div class="eq-rows">
        ${head}
        ${list.filter((e) => e.group === g).sort(order).map((e) => equipmentRow(e, stats.get(e.id))).join('')}
      </div>
    </section>`).join('');
}

// ---------- Статистика по оборудованию ----------
const PERIODS = [
  { id: '7', label: '7 дней', days: 7 },
  { id: '30', label: '30 дней', days: 30 },
  { id: 'all', label: 'всё время', days: null },
];
const currentPeriod = () => PERIODS.find((p) => p.id === state.eqPeriod) || PERIODS[1];
const periodLabel = () => currentPeriod().label;
const periodStart = () => {
  const p = currentPeriod();
  return p.days ? Date.now() - p.days * 86400000 : 0;
};

function periodSwitch() {
  return `
    <div class="period">
      <span class="period__label">Период:</span>
      <div class="segmented segmented--inline">
        ${PERIODS.map((p) => `<button class="segmented__btn${p.id === currentPeriod().id ? ' is-active' : ''}" data-period="${p.id}">${p.label}</button>`).join('')}
      </div>
    </div>`;
}

// Простой считается только в пределах периода; незакрытый ремонт — до текущего момента.
function eqStats(eqId, from) {
  const now = Date.now();
  const list = DB.data.breakdowns.filter((b) => b.equipmentId === eqId);
  const inRepair = list.find((b) => b.status === 'repair') || null;
  const started = list.filter((b) => new Date(b.start) >= from);
  let downtime = 0;
  for (const b of list) {
    const s = Math.max(new Date(b.start).getTime(), from);
    const e = b.end ? new Date(b.end).getTime() : now;
    if (e > s) downtime += e - s;
  }
  const closed = started.filter((b) => b.status === 'done');
  const avgRepair = closed.length
    ? closed.reduce((n, b) => n + (new Date(b.end) - new Date(b.start)), 0) / closed.length
    : null;
  const byType = {};
  for (const b of started) byType[b.type] = (byType[b.type] || 0) + 1;
  const last = list.reduce((m, b) => (!m || b.start > m ? b.start : m), null);
  return { inRepair, count: started.length, total: list.length, downtime, avgRepair, byType, last, history: list };
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const statTile = (label, value, tone = '') => `
  <div class="stat${tone ? ` stat--${tone}` : ''}">
    <span class="stat__label">${label}</span>
    <span class="stat__value">${value}</span>
  </div>`;

// Строка перечня; нажатие раскрывает под ней полную историю станка.
function equipmentRow(e, s) {
  const open = state.eqOpen.has(e.id);
  const repair = !!s.inRepair;
  return `
    <div class="eq-entry${open ? ' is-open' : ''}">
      <button class="eq-row eq-row--${repair ? 'repair' : 'ok'}" data-eq="${e.id}" aria-expanded="${open}">
        <span class="eq-row__name">
          <span class="bd-item__name">${escapeHtml(e.name)}${e.mark ? ` <span class="bd-item__mark">${escapeHtml(e.mark)}</span>` : ''}</span>
          <span class="eq-row__sub">${repair ? escapeHtml(s.inRepair.reason) : e.inv ? `Инв. № ${escapeHtml(e.inv)}` : ''}</span>
        </span>
        <span class="eq-row__status">
          <span class="dot dot--${repair ? 'repair' : 'ok'}"></span>
          ${repair ? `В ремонте · ${fmtDuration(Date.now() - new Date(s.inRepair.start))}` : 'Работает'}
        </span>
        <span class="eq-row__nums">
          <span class="eq-row__num"><b>${s.count}</b><i> ${plural(s.count, 'поломка', 'поломки', 'поломок')}</i></span>
          <span class="eq-row__num"><b>${fmtDuration(s.downtime)}</b><i> простоя</i></span>
          <span class="eq-row__last"><i>последняя </i>${s.last ? fmtDateTime(s.last) : '—'}</span>
        </span>
        <span class="eq-row__chev">${ICONS.chevron}</span>
      </button>
      ${open ? `<div class="eq-detail">${equipmentDetails(e, s)}</div>` : ''}
    </div>`;
}

function equipmentDetails(eq, s) {
  const types = Object.entries(s.byType).sort((a, b) => b[1] - a[1]);
  const max = types.length ? types[0][1] : 0;
  const history = [...s.history].sort((a, b) => b.start.localeCompare(a.start));
  return `
    <div class="eq-info">
      <span>Подгруппа: <b>${escapeHtml(eq.group)}</b></span>
      ${eq.mark ? `<span>Маркировка: <b>${escapeHtml(eq.mark)}</b></span>` : ''}
      ${eq.inv ? `<span>Инв. №: <b>${escapeHtml(eq.inv)}</b></span>` : ''}
      ${state.admin ? `<button class="btn eq-edit" data-eq-edit="${eq.id}">${ICONS.edit} Изменить данные</button>` : ''}
    </div>
    <h4 class="modal__sub">За ${periodLabel()}</h4>
    <div class="stat-row stat-row--compact">
      ${statTile('Поломок', s.count)}
      ${statTile('Простой', fmtDuration(s.downtime))}
      ${statTile('Средний ремонт', s.avgRepair === null ? '—' : fmtDuration(s.avgRepair))}
    </div>
    ${types.length ? `
      <h4 class="modal__sub">По типам поломок</h4>
      <div class="type-bars">
        ${types.map(([t, n]) => `
          <div class="type-bar" title="${escapeHtml(t)}: ${n}">
            <span class="type-bar__label">${escapeHtml(t)}</span>
            <span class="type-bar__track"><span class="type-bar__fill" style="width:${(n / max) * 100}%"></span></span>
            <span class="type-bar__value">${n}</span>
          </div>`).join('')}
      </div>` : ''}
    <h4 class="modal__sub">История поломок · всего ${s.total}</h4>
    ${history.length
      ? `<div class="bd-list">${history.map((b) => breakdownCard(b, false, false)).join('')}</div>`
      : '<p class="muted">Поломок не было.</p>'}`;
}

const TAB_VIEWS = {
  equipment: equipmentView, current: currentShiftView, history: historyView,
  repair: repairView, warehouse: warehouseView, manuals: manualsView, shifts: shiftsSettingsView,
};

// ================= История смен =================
const HISTORY_PAGE = 20;

// Поломка относится к смене, если была зарегистрирована в ней; «переходящая» —
// если началась раньше, но в эту смену ещё была в ремонте.
function shiftBreakdowns(shift, end) {
  const s = shift.start;
  const own = [], carried = [];
  for (const b of DB.data.breakdowns) {
    if (b.shiftId === shift.id) own.push(b);
    else if (b.start < s && (!b.end || b.end > s)) carried.push(b);
  }
  own.sort((a, b) => a.start.localeCompare(b.start));
  carried.sort((a, b) => a.start.localeCompare(b.start));
  // Простой в пределах смены по всем поломкам, которые её задели.
  let downtime = 0;
  for (const b of [...own, ...carried]) {
    const from = Math.max(new Date(b.start), new Date(s));
    const to = Math.min(b.end ? new Date(b.end) : new Date(), end);
    if (to > from) downtime += to - from;
  }
  return { own, carried, downtime };
}

// Смена — один блок: шапка (тип, дата, номер, мастер, время, сводка) и строки поломок.
// Текущая и предыдущая смены раскрыты, остальные свёрнуты до шапки; пустые не сворачиваются.
function historyView() {
  const cur = DB.data.currentShift;
  const shifts = [...DB.data.shifts].sort((a, b) => b.start.localeCompare(a.start));
  if (cur) shifts.unshift({ ...cur, current: true });
  if (!shifts.length) {
    return `
      <div class="empty">
        <div class="empty__icon">${ICONS.history}</div>
        <p>Смен ещё нет.</p>
      </div>`;
  }

  // По умолчанию раскрываем две последние смены — один раз, дальше решает пользователь.
  for (const sh of shifts.slice(0, 2)) {
    if (state.histSeeded.has(sh.id)) continue;
    state.histSeeded.add(sh.id);
    state.histOpen.add(sh.id);
  }

  const shown = shifts.slice(0, state.historyLimit);
  const more = shifts.length > shown.length
    ? `<button class="btn hist-more" data-more>Показать ещё (${shifts.length - shown.length})</button>`
    : '';
  return shown.map(shiftCard).join('') + more;
}

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// «вт 6 окт»; через полночь — «вт 6 → ср 7 окт» (в разных месяцах — «пт 31 окт → сб 1 ноя»).
function shiftDays(start, end) {
  const day = (d) => `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()}`;
  const mon = (d) => MONTHS_SHORT[d.getMonth()];
  if (start.toDateString() === end.toDateString()) return `${day(start)} ${mon(start)}`;
  if (start.getMonth() === end.getMonth()) return `${day(start)} → ${day(end)} ${mon(end)}`;
  return `${day(start)} ${mon(start)} → ${day(end)} ${mon(end)}`;
}

// Плановый конец смены; у старых записей без plannedEnd — по расписанию.
const shiftPlannedEnd = (sh) => (sh.plannedEnd ? new Date(sh.plannedEnd) : plannedEnd(sh.type, new Date(sh.start)));

// Конец смены в шапке: «08:15 (+15 мин)» — переработка, «07:30 (−30 мин)» — раньше плана;
// у идущей — плановый конец и «осталось …» (обновляется в refreshTimers).
function shiftEndHtml(sh) {
  const plan = shiftPlannedEnd(sh);
  if (sh.current) {
    return `${fmtTime(plan)} <span class="hist-head__left" data-shift-left="${plan.toISOString()}">${shiftLeftText(plan)}</span>`;
  }
  const end = new Date(sh.end);
  const diff = end - plan;
  const note = Math.abs(diff) <= 5 * 60000 ? ''
    : diff > 0 ? ` <span class="hist-over">(+${fmtDuration(diff)})</span>`
    : ` <span class="muted">(−${fmtDuration(-diff)})</span>`;
  return `${fmtTime(end)}${note}`;
}
const shiftLeftText = (plan) => {
  const left = plan - Date.now();
  return left >= 0 ? `· осталось ${fmtDuration(left)}` : `· сверх плана ${fmtDuration(-left)}`;
};

function shiftCard(sh) {
  const start = new Date(sh.start);
  const end = sh.current ? new Date() : new Date(sh.end);
  const { own, carried, downtime } = shiftBreakdowns(sh, end);
  const empty = !own.length && !carried.length;
  const open = !empty && state.histOpen.has(sh.id);
  const inRepair = [...own, ...carried].filter((b) => b.status === 'repair').length;
  const night = sh.type === 'night';

  const title = `
    <span class="hist-head__title">
      <span class="hist-head__icon" aria-hidden="true">${ICONS[night ? 'moon' : 'sun']}</span>
      <span>${escapeHtml(SETTINGS().shiftTypes[sh.type]?.label || '')} смена · ${shiftDays(start, sh.current ? shiftPlannedEnd(sh) : end)}</span>
    </span>`;
  const meta = `
    <span class="hist-head__meta">
      ${sh.number ? `<span class="muted">Смена №</span> ${escapeHtml(sh.number)} <span class="muted">·</span> ` : ''}${escapeHtml(sh.master)}
      <span class="muted">·</span> <span class="tnum">${fmtTime(start)}–${shiftEndHtml(sh)}</span>
    </span>`;
  const summary = empty
    ? '<span class="hist-head__sum muted">Поломок не было</span>'
    : `<span class="hist-head__sum">
        ${own.length ? `<b>${own.length}</b> ${plural(own.length, 'поломка', 'поломки', 'поломок')}` : 'Своих поломок нет'}
        ${carried.length ? ` · ↪ <b>${carried.length}</b> с прошлых смен` : ''} · простой <b class="tnum"${sh.current ? ' data-shift-downtime' : ''}>${fmtDuration(downtime)}</b>
        <span class="hist-head__note" title="Простой всех станков за смену складывается: два станка стоят по 6 ч — это 12 ч простоя">сумма по станкам</span>
        ${inRepair ? `<span class="hist-head__repair">· <b>${inRepair}</b> в ремонте</span>` : ''}
      </span>`;
  const aside = `
    <span class="hist-head__aside">
      ${sh.current ? '<span class="hist-now">идёт сейчас</span>' : ''}
      ${empty ? '' : `<span class="hist-head__chev">${ICONS.chevron}</span>`}
    </span>`;
  const head = empty
    ? `<div class="hist-head">${title}${aside}${meta}${summary}</div>`
    : `<button class="hist-head" data-hist="${sh.id}" aria-expanded="${open}">${title}${aside}${meta}${summary}</button>`;

  const rows = (list, isCarried) => list.map((b) => withTrash(breakdownRow(b, isCarried), b)).join('');
  const headBlock = state.admin && state.editing && !sh.current
    ? `<div class="hist-headrow">${head}<button class="trash" data-del-shift="${sh.id}" title="Удалить смену" aria-label="Удалить смену">${ICONS.trash}</button></div>`
    : head;
  return `
    <section class="hist-shift${sh.current ? ' hist-shift--current' : ''}${empty ? ' hist-shift--empty' : ''}${open ? ' is-open' : ''}">
      ${headBlock}
      ${open && own.length ? `<div class="hist-rows">${rows(own, false)}</div>` : ''}
      ${open && carried.length ? `
        <div class="hist-carried">↪ Перешли с прошлых смен · ${carried.length}</div>
        <div class="hist-rows">${rows(carried, true)}</div>` : ''}
    </section>`;
}

// Строка поломки: время | станок и причина | длительность (и «В ремонте» только у незакрытых).
// carried — поломка из прошлой смены: время с датой и пометка, из какой она смены.
function breakdownRow(b, carried = false) {
  const done = b.status === 'done';
  const dur = fmtDuration((done ? new Date(b.end) : new Date()) - new Date(b.start));
  let from = '';
  if (carried) {
    const own = DB.data.shifts.find((s) => s.id === b.shiftId);
    from = own
      ? `от смены${own.number ? ` № ${escapeHtml(own.number)}` : ''} · ${escapeHtml(own.master)}`
      : `от смены · ${escapeHtml(b.master)}`;
  }
  return `
    <button class="hist-row hist-row--${b.status}${carried ? ' hist-row--carried' : ''}" data-bd="${b.id}">
      <span class="hist-row__time">${carried ? `<small>${fmtDate(new Date(b.start)).slice(0, 5)}</small>` : ''}${fmtTime(new Date(b.start))}</span>
      <span class="hist-row__main">
        <span class="hist-row__name">${escapeHtml(equipmentName(b.equipmentId))}</span>
        <span class="hist-row__reason">${escapeHtml(b.reason)} <span class="muted">· ${escapeHtml(b.type)}</span></span>
        ${from ? `<span class="hist-row__from">${from}</span>` : ''}
      </span>
      <span class="hist-row__side">
        <span class="hist-row__dur"${done ? '' : ` data-since="${b.start}"`}>${dur}</span>
        ${done ? '' : '<span class="bd-status bd-status--repair">В ремонте</span>'}
      </span>
    </button>`;
}

// ================= Данные смен (только режим настроек) =================
// Изменения сохраняются сразу. Уже записанные смены и поломки не меняются:
// в них остаются те фамилии и время, что были на момент записи.

// Мастера — пары { name, number }; номера смен — строки.
// Переименование номера переносится в привязки мастеров, удаление — снимает привязку.

function numberSelect(attrs, value) {
  const nums = SETTINGS().shiftNumbers;
  return `
    <select class="set-num" ${attrs} aria-label="Номер смены">
      <option value="">без №</option>
      ${nums.map((n) => `<option value="${escapeHtml(n)}"${n === value ? ' selected' : ''}>№ ${escapeHtml(n)}</option>`).join('')}
    </select>`;
}

function shiftsSettingsView() {
  const s = SETTINGS();
  const trash = (key, i) =>
    `<button class="trash trash--sm" data-list-del="${key}" data-idx="${i}" title="Удалить" aria-label="Удалить">${ICONS.trash}</button>`;

  const masters = `
    <section class="set-block">
      <h3 class="eq-group__title">Мастера · ${s.masters.length}</h3>
      <div class="set-list">
        ${s.masters.map((m, i) => `
          <div class="set-item">
            <input value="${escapeHtml(m.name)}" data-master-name="${i}" aria-label="Фамилия мастера">
            ${numberSelect(`data-master-number="${i}"`, m.number)}
            ${trash('masters', i)}
          </div>`).join('') || '<p class="muted">Список пуст.</p>'}
      </div>
      <div class="set-add">
        <input placeholder="Фамилия мастера" data-list-new="masters" autocomplete="off">
        ${numberSelect('id="new-master-number"', '')}
        <button class="btn btn--primary" data-list-add="masters">Добавить</button>
      </div>
    </section>`;

  const numbers = `
    <section class="set-block">
      <h3 class="eq-group__title">Номера смен · ${s.shiftNumbers.length}</h3>
      <div class="set-list">
        ${s.shiftNumbers.map((n, i) => {
          const who = s.masters.filter((m) => m.number === n).map((m) => m.name);
          return `
          <div class="set-item">
            <input value="${escapeHtml(n)}" data-number="${i}" aria-label="Номер смены">
            <span class="set-who">${who.length ? escapeHtml(who.join(', ')) : 'нет мастера'}</span>
            ${trash('shiftNumbers', i)}
          </div>`;
        }).join('') || '<p class="muted">Список пуст.</p>'}
      </div>
      <div class="set-add">
        <input placeholder="Например: 5" data-list-new="shiftNumbers" autocomplete="off">
        <button class="btn btn--primary" data-list-add="shiftNumbers">Добавить</button>
      </div>
    </section>`;

  const times = Object.entries(s.shiftTypes).map(([id, t]) => {
    const start = atTime(new Date(), t.start);
    const dur = fmtDuration(plannedEnd(id, start) - start);
    return `
      <div class="set-time">
        <span class="set-time__label">${escapeHtml(t.label)} смена</span>
        <label class="field"><span class="field__label">Начало</span><input type="time" value="${t.start}" data-time="${id}" data-field="start"></label>
        <label class="field"><span class="field__label">Конец</span><input type="time" value="${t.end}" data-time="${id}" data-field="end"></label>
        <span class="set-time__dur">${dur}</span>
      </div>`;
  }).join('');

  return `
    <p class="muted set-note">Изменения сохраняются сразу. Уже записанные смены и поломки не меняются.</p>
    <div class="set-grid">
      ${masters}
      ${numbers}
    </div>
    <section class="set-block">
      <h3 class="eq-group__title">Время смен</h3>
      <div class="set-times">${times}</div>
      <p class="error" id="set-time-error" hidden></p>
    </section>`;
}

const masterNames = () => SETTINGS().masters.map((m) => m.name);

function addListItem(key) {
  const input = document.querySelector(`[data-list-new="${key}"]`);
  const v = input.value.trim();
  if (!v) return input.focus();
  const taken = key === 'masters' ? masterNames() : SETTINGS().shiftNumbers;
  if (taken.includes(v)) {
    input.setCustomValidity('Уже есть в списке');
    input.reportValidity();
    setTimeout(() => input.setCustomValidity(''), 1500);
    return;
  }
  const number = key === 'masters' ? $('#new-master-number').value : '';
  DB.update((d) => {
    if (key === 'masters') d.settings.masters.push({ name: v, number });
    else d.settings.shiftNumbers.push(v);
  });
  document.querySelector(`[data-list-new="${key}"]`)?.focus();
}

$('#panel').addEventListener('click', (e) => {
  const add = e.target.closest('[data-list-add]');
  if (add) return addListItem(add.dataset.listAdd);
  const del = e.target.closest('[data-list-del]');
  if (!del) return;
  const key = del.dataset.listDel, idx = Number(del.dataset.idx);
  DB.update((d) => {
    const [removed] = d.settings[key].splice(idx, 1);
    // Удалили номер — мастера с ним остаются без номера.
    if (key === 'shiftNumbers') d.settings.masters.forEach((m) => { if (m.number === removed) m.number = ''; });
  });
});

$('#panel').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.listNew) addListItem(e.target.dataset.listNew);
});

$('#panel').addEventListener('change', (e) => {
  const el = e.target;
  // Пустое значение или дубль — откатываем поле.
  if (el.dataset.masterName !== undefined) {
    const idx = Number(el.dataset.masterName), v = el.value.trim();
    const names = masterNames();
    if (!v || names.some((x, i) => x === v && i !== idx)) { el.value = names[idx]; return; }
    DB.update((d) => { d.settings.masters[idx].name = v; });
  }
  if (el.dataset.masterNumber !== undefined) {
    DB.update((d) => { d.settings.masters[Number(el.dataset.masterNumber)].number = el.value; });
  }
  if (el.dataset.number !== undefined) {
    const idx = Number(el.dataset.number), v = el.value.trim();
    const nums = SETTINGS().shiftNumbers;
    if (!v || nums.some((x, i) => x === v && i !== idx)) { el.value = nums[idx]; return; }
    DB.update((d) => {
      const old = d.settings.shiftNumbers[idx];
      d.settings.shiftNumbers[idx] = v;
      d.settings.masters.forEach((m) => { if (m.number === old) m.number = v; });
    });
  }
  if (el.dataset.time) {
    const type = SETTINGS().shiftTypes[el.dataset.time];
    const next = { ...type, [el.dataset.field]: el.value };
    if (!el.value || next.start === next.end) {
      $('#set-time-error').textContent = 'Начало и конец смены не могут совпадать.';
      $('#set-time-error').hidden = false;
      el.value = type[el.dataset.field];
      return;
    }
    DB.update((d) => { d.settings.shiftTypes[el.dataset.time][el.dataset.field] = el.value; });
  }
});

// Журнал передач ремонта между сменами — для окна с полной информацией.
function handoverLog(b) {
  if (!b.handovers?.length) return '';
  return `
    <h4 class="modal__sub">Передачи между сменами</h4>
    <ul class="ho-log">
      ${b.handovers.map((h) => `<li>${fmtDateTime(h.at)} — передал мастер <b>${escapeHtml(h.master)}</b></li>`).join('')}
    </ul>`;
}

$('#panel').addEventListener('click', (e) => {
  if (e.target.closest('[data-more]')) {
    state.historyLimit += HISTORY_PAGE;
    return renderTab();
  }

  // Шапка смены в истории — свернуть / раскрыть.
  const hist = e.target.closest('[data-hist]');
  if (hist) {
    const id = hist.dataset.hist;
    if (state.histOpen.has(id)) state.histOpen.delete(id); else state.histOpen.add(id);
    return renderTab();
  }

  const delShift = e.target.closest('[data-del-shift]');
  if (delShift) return confirmDeleteShift(DB.data.shifts.find((x) => x.id === delShift.dataset.delShift));

  const del = e.target.closest('[data-del]');
  if (del) {
    if (del.dataset.kind === 'repair') return confirmDeleteRepair(DB.data.repairs.find((x) => x.id === del.dataset.del));
    if (del.dataset.kind === 'part') return confirmDeletePart(DB.data.parts.find((x) => x.id === del.dataset.del));
    return confirmDeleteBreakdown(DB.data.breakdowns.find((x) => x.id === del.dataset.del));
  }

  const part = e.target.closest('[data-part]');
  if (part) {
    const p = DB.data.parts.find((x) => x.id === part.dataset.part);
    return state.admin ? openPartForm(p) : openPartInfo(p);
  }

  const rq = e.target.closest('[data-rq]');
  if (rq) return openRepair(DB.data.repairs.find((x) => x.id === rq.dataset.rq));

  const bd = e.target.closest('[data-bd]');
  if (bd) return openBreakdownForm(DB.data.breakdowns.find((x) => x.id === bd.dataset.bd));

  // Плитка станка: стоит — открываем его поломку, работает — форму новой остановки.
  const machine = e.target.closest('[data-machine]');
  if (machine) {
    const open = machine.dataset.machineBd;
    return open
      ? openBreakdownForm(DB.data.breakdowns.find((x) => x.id === open))
      : openBreakdownForm(null, machine.dataset.machine);
  }

  const go = e.target.closest('[data-goto]');
  if (go) return goTab(go.dataset.goto);

  const period = e.target.closest('[data-period]');
  if (period) {
    state.eqPeriod = period.dataset.period;
    store.set('eqPeriod', state.eqPeriod);
    return renderTab();
  }

  const edit = e.target.closest('[data-eq-edit]');
  if (edit) return openEquipmentForm(getEquipment().find((x) => x.id === edit.dataset.eqEdit));

  const item = e.target.closest('[data-eq]');
  if (item) {
    const id = item.dataset.eq;
    if (state.eqOpen.has(id)) state.eqOpen.delete(id); else state.eqOpen.add(id);
    renderTab();
  }
});

// В режиме редактирования (режим настроек + «Редактировать») рядом с поломкой — корзина.
function withTrash(html, item, kind = 'bd') {
  if (!(state.admin && state.editing)) return html;
  const title = { repair: 'Удалить заявку', part: 'Удалить запчасть' }[kind] || 'Удалить поломку';
  return `
    <div class="bd-wrap">
      ${html}
      <button class="trash" data-del="${item.id}" data-kind="${kind}" title="${title}" aria-label="${title}">${ICONS.trash}</button>
    </div>`;
}

const NEW_GROUP = '__new__';

function openEquipmentForm(eq = null) {
  const groups = getGroups();
  const opts = groups.map((g) => `<option${eq && eq.group === g ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('');
  openModal(eq ? 'Изменить оборудование' : 'Добавить оборудование', `
    <label class="field">
      <span class="field__label">Подгруппа</span>
      <select id="eq-group">
        ${groups.length && !eq ? '<option value="" disabled selected>Выберите подгруппу</option>' : ''}
        ${opts}
        <option value="${NEW_GROUP}"${groups.length ? '' : ' selected'}>+ Новая подгруппа…</option>
      </select>
    </label>
    <label class="field" id="eq-group-new-wrap"${groups.length ? ' hidden' : ''}>
      <span class="field__label">Название новой подгруппы</span>
      <input id="eq-group-new" autocomplete="off">
    </label>
    <label class="field">
      <span class="field__label">Наименование оборудования</span>
      <input id="eq-name" autocomplete="off" value="${eq ? escapeHtml(eq.name) : ''}">
    </label>
    <label class="field">
      <span class="field__label">Маркировка</span>
      <input id="eq-mark" autocomplete="off" value="${eq ? escapeHtml(eq.mark) : ''}">
    </label>
    <label class="field">
      <span class="field__label">Инвентарный номер</span>
      <input id="eq-inv" autocomplete="off" value="${eq ? escapeHtml(eq.inv) : ''}">
    </label>
    <label class="field">
      <span class="field__label">Позиция в цеху</span>
      <input id="eq-pos" type="number" inputmode="numeric" step="1" placeholder="Необязательно — порядок плиток внутри подгруппы" value="${eq?.pos ?? ''}">
    </label>
    <p class="error" id="eq-error" aria-live="polite" hidden></p>`, [
    { label: 'Отмена' },
    { label: 'Сохранить', primary: true, onClick: () => saveEquipment(eq) },
  ]);

  $('#eq-group').addEventListener('change', (e) => {
    const isNew = e.target.value === NEW_GROUP;
    $('#eq-group-new-wrap').hidden = !isNew;
    if (isNew) $('#eq-group-new').focus();
  });
}

function saveEquipment(eq) {
  const val = (id) => $(id).value.trim();
  const sel = $('#eq-group').value;
  const group = sel === NEW_GROUP ? val('#eq-group-new') : sel;
  const posRaw = val('#eq-pos');
  const data = { group, name: val('#eq-name'), mark: val('#eq-mark'), inv: val('#eq-inv'), pos: posRaw === '' ? null : Number(posRaw) };

  const list = getEquipment();
  const error = (msg, field) => fieldError(field, msg, '#eq-error');
  if (!data.group) return error('Укажите подгруппу.', sel === NEW_GROUP ? '#eq-group-new' : '#eq-group');
  if (!data.name) return error('Укажите наименование оборудования.', '#eq-name');
  if (data.inv && list.some((x) => x.inv === data.inv && (!eq || x.id !== eq.id))) {
    return error(`Инвентарный номер ${data.inv} уже есть в перечне.`, '#eq-inv');
  }

  DB.update((d) => {
    const found = eq && d.equipment.find((x) => x.id === eq.id);
    if (found) Object.assign(found, data);
    else d.equipment.push({ id: uid(), ...data });
  });
}

// ================= Поломки =================
// Запись: { id, shiftId, master, equipmentId, start, reason, type,
//           status: 'repair' | 'done', end, repairedBy }

const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDateTime = (iso) => { const d = new Date(iso); return `${fmtDate(d)} ${fmtTime(d)}`; };

function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} ч ${min % 60} мин` : `${min} мин`;
}

const equipmentName = (id) => DB.data.equipment.find((e) => e.id === id)?.name || 'Оборудование удалено';

// showEq = false — внутри карточки станка: название не повторяем, в заголовке причина.
function breakdownCard(b, clickable = true, showEq = true) {
  const done = b.status === 'done';
  const dur = fmtDuration((done ? new Date(b.end) : new Date()) - new Date(b.start));
  const tag = clickable ? 'button' : 'div';
  const mark = DB.data.equipment.find((e) => e.id === b.equipmentId)?.mark;
  return `
    <${tag} class="bd-item bd-item--${b.status}"${clickable ? ` data-bd="${b.id}"` : ''}>
      <span class="bd-item__head">
        <span class="bd-item__name">${showEq ? `${escapeHtml(equipmentName(b.equipmentId))}${mark ? ` <span class="bd-item__mark">${escapeHtml(mark)}</span>` : ''}` : escapeHtml(b.reason)}</span>
        <span class="bd-status bd-status--${b.status}">${done ? 'Отремонтировано' : 'В ремонте'}</span>
      </span>
      ${showEq ? `<span class="bd-item__reason">${escapeHtml(b.reason)}</span>` : ''}
      <span class="bd-item__meta">
        <span>${escapeHtml(b.type)}</span>
        <span>Остановка: <b>${fmtDateTime(b.start)}</b></span>
        ${done ? `<span>Окончание: <b>${fmtDateTime(b.end)}</b></span>` : ''}
        <span>Простой: <b${done ? '' : ` data-since="${b.start}"`}>${dur}</b></span>
        <span>Мастер: <b>${escapeHtml(b.master)}</b></span>
        ${b.handovers?.length ? `<span>Передано сменам: <b>${b.handovers.length}</b></span>` : ''}
        ${done ? `<span>Отремонтировал: <b>${escapeHtml(b.repairedBy)}</b></span>` : ''}
      </span>
      ${done ? usedLine(b.used) : ''}
    </${tag}>`;
}

// «＋ Остановка»: сначала выбор станка плитками (тот же порядок, что на «Смене»).
// Стоящие станки видны, но выбрать их нельзя — по ним уже открыта поломка.
function openMachinePicker() {
  if (!getEquipment().length) return openBreakdownForm(); // там же подсказка, что перечень пуст
  const open = openBreakdowns();
  openModal('Какой станок остановился?', `
    <div class="machines--pick">
      ${machineGroups((e) => {
        const down = open.has(e.id);
        return `
          <button type="button" class="machine${down ? ' machine--down' : ''}" data-pick="${e.id}"${down ? ' disabled' : ''}>
            <span class="machine__name">${escapeHtml(e.name)}</span>
            ${e.mark ? `<span class="machine__mark">${escapeHtml(e.mark)}</span>` : ''}
            ${down ? '<span class="machine__reason"><span class="sym" aria-hidden="true">■</span> уже стоит</span>' : ''}
          </button>`;
      })}
    </div>`, [{ label: 'Отмена' }], { wide: true });
}

$('#modal').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-pick]');
  if (pick && !pick.disabled) openBreakdownForm(null, pick.dataset.pick);
});

// Текущая смена: сетка станков, ниже — всё, что ещё в ремонте (в том числе с прошлых смен), и поломки этой смены.
function currentShiftView() {
  const shiftId = DB.data.currentShift?.id;
  const all = DB.data.breakdowns;
  const inRepair = all.filter((b) => b.status === 'repair').sort((a, b) => a.start.localeCompare(b.start));
  const doneHere = all.filter((b) => b.status === 'done' && b.shiftId === shiftId).sort((a, b) => b.start.localeCompare(a.start));

  const section = (title, list) => list.length
    ? `<section class="bd-section"><h3 class="eq-group__title">${title} · ${list.length}</h3><div class="bd-list">${list.map((b) => withTrash(breakdownCard(b), b)).join('')}</div></section>`
    : '';
  const list = inRepair.length || doneHere.length
    ? section('В ремонте', inRepair) + section('Отремонтировано в эту смену', doneHere)
    : '<p class="muted bd-none">Поломок в эту смену не было.</p>';
  return machineGrid() + list;
}

// ---------- Сетка станков ----------
// Станок стоит, если по нему есть поломка «в ремонте» (берём самую раннюю).

function openBreakdowns() {
  const map = new Map();
  for (const b of DB.data.breakdowns) {
    if (b.status !== 'repair') continue;
    const cur = map.get(b.equipmentId);
    if (!cur || b.start < cur.start) map.set(b.equipmentId, b);
  }
  return map;
}

function machineGrid() {
  const list = getEquipment();
  if (!list.length) {
    return `
      <div class="empty empty--inline">
        <div class="empty__icon">${ICONS.equipment}</div>
        <p>Оборудование ещё не добавлено — сетка станков появится, когда оно будет в перечне.</p>
        <button class="btn" data-goto="equipment">Открыть «Оборудование»</button>
      </div>`;
  }
  const open = openBreakdowns();
  const down = list.filter((e) => open.has(e.id)).length;
  const working = list.length - down;
  const shift = DB.data.currentShift;
  const downtime = shift ? fmtDuration(shiftBreakdowns(shift, new Date()).downtime) : null;

  const summary = `
    <p class="machines__summary">
      <b>${working} из ${list.length}</b> ${plural(working, 'работает', 'работают', 'работают')}${down ? ` · <span class="machines__down">${down} ${plural(down, 'стоит', 'стоят', 'стоят')}</span>` : ''}
      ${downtime ? ` · простой за смену <b data-shift-downtime>${downtime}</b>` : ''}
    </p>`;

  return `<div class="machines-wrap">${summary}${machineGroups((e) => machineTile(e, open.get(e.id)))}</div>`;
}

// Группы станков в общем порядке; tile(e) рисует плитку. Используется на «Смене» и в окне выбора станка.
const machineGroups = (tile) => getGroups().map((g) => `
  <section class="machines__group">
    <h3 class="eq-group__title">${escapeHtml(g)}</h3>
    <div class="machines">
      ${getEquipment().filter((e) => e.group === g).sort(byPos).map(tile).join('')}
    </div>
  </section>`).join('');

// Плитка станка. Работает — нейтральная, без подписи (норму не подписываем);
// стоит — красная, с причиной и таймером простоя.
function machineTile(e, bd) {
  const mark = e.mark ? `<span class="machine__mark">${escapeHtml(e.mark)}</span>` : '';
  if (!bd) {
    return `
      <button class="machine" data-machine="${e.id}" title="${escapeHtml(e.name)}: работает${state.viewer ? '' : '. Нажмите, чтобы записать остановку'}">
        <span class="machine__name">${escapeHtml(e.name)}</span>
        ${mark}
      </button>`;
  }
  return `
    <button class="machine machine--down" data-machine="${e.id}" data-machine-bd="${bd.id}" title="${escapeHtml(e.name)}: стоит с ${fmtWhen(bd.start)}">
      <span class="machine__name">${escapeHtml(e.name)}</span>
      ${mark}
      <span class="machine__reason"><span class="sym" aria-hidden="true">■</span> ${escapeHtml(bd.reason)}</span>
      <span class="machine__timer" data-since="${bd.start}">${fmtDuration(Date.now() - new Date(bd.start))}</span>
    </button>`;
}

// Фамилии, которые уже вводили в «Кто закончил ремонт», — для подсказок.
const knownRepairers = () =>
  [...new Set(DB.data.breakdowns.map((b) => b.repairedBy).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));

// eqId — станок выбран заранее (нажали плитку в сетке станков).
function openBreakdownForm(bd = null, eqId = null) {
  const eqList = DB.data.equipment;
  if (!eqList.length) {
    openModal('Добавить поломку', '<p>В перечне ещё нет оборудования.</p><p class="muted">Сначала добавьте его во вкладке «Перечень оборудования» в режиме настроек.</p>', [
      { label: 'Понятно', primary: true },
    ]);
    return;
  }

  // Закрытую поломку в обычном режиме можно только посмотреть.
  if (state.viewer && !bd) return;
  const readOnly = bd && (state.viewer || (bd.status === 'done' && !state.admin));
  if (readOnly) {
    openModal('Поломка', `<div class="bd-list">${breakdownCard(bd, false)}</div>${handoverLog(bd)}`, [{ label: 'Закрыть', primary: true }]);
    return;
  }

  const groups = getGroups();
  const curEq = eqList.find((e) => e.id === (bd ? bd.equipmentId : eqId));
  const master = bd ? bd.master : DB.data.currentShift?.master || '';
  let status = bd ? bd.status : 'repair';
  let type = bd ? bd.type : '';

  const chips = (name, items, active) => items
    .map((v) => `<button type="button" class="chip${v === active ? ' is-active' : ''}" data-${name}="${escapeHtml(v)}">${escapeHtml(v)}</button>`)
    .join('');

  const actions = [
    { label: 'Отмена' },
    { label: 'Сохранить', primary: true, onClick: () => saveBreakdown(bd, { status, type }) },
  ];

  openModal(bd ? 'Поломка' : 'Добавить поломку', `
    <label class="field">
      <span class="field__label">Подгруппа</span>
      <select id="bd-group">
        <option value="" disabled${curEq ? '' : ' selected'}>Выберите подгруппу</option>
        ${groups.map((g) => `<option${curEq && curEq.group === g ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('')}
      </select>
    </label>
    <label class="field">
      <span class="field__label">Оборудование</span>
      <select id="bd-eq"${curEq ? '' : ' disabled'}></select>
    </label>
    <label class="field">
      <span class="field__label">Время начала остановки</span>
      <input id="bd-start" type="datetime-local" value="${toLocalInput(bd ? new Date(bd.start) : new Date())}">
    </label>
    <label class="field">
      <span class="field__label">Причина остановки</span>
      <textarea id="bd-reason" rows="3" placeholder="Что случилось">${bd ? escapeHtml(bd.reason) : ''}</textarea>
    </label>
    <div class="field">
      <span class="field__label">Тип поломки</span>
      <div class="chips" id="bd-type">${chips('type', CONFIG.breakdownTypes, type)}</div>
    </div>
    <div class="field">
      <span class="field__label">Состояние</span>
      <div class="segmented" id="bd-status">
        <button type="button" class="segmented__btn" data-status="repair">В ремонте</button>
        <button type="button" class="segmented__btn" data-status="done">Ремонт завершён</button>
      </div>
    </div>
    <div class="bd-done" id="bd-done-fields">
      <label class="field">
        <span class="field__label">Время окончания ремонта</span>
        <input id="bd-end" type="datetime-local" value="${toLocalInput(bd && bd.end ? new Date(bd.end) : new Date())}">
      </label>
      <label class="field">
        <span class="field__label">Кто закончил ремонт</span>
        <input id="bd-by" list="bd-by-list" autocomplete="off" placeholder="Фамилия" value="${bd && bd.repairedBy ? escapeHtml(bd.repairedBy) : ''}">
        <datalist id="bd-by-list">${knownRepairers().map((n) => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
      </label>
      ${usedField(bd?.used || [])}
    </div>
    <div class="field">
      <span class="field__label">Остановка у мастера</span>
      <div class="field__auto">${escapeHtml(master) || '—'}</div>
    </div>
    <p class="error" id="bd-error" aria-live="polite" hidden></p>`, actions, { fill: true });

  const fillEquipment = () => {
    const g = $('#bd-group').value;
    const sel = $('#bd-eq');
    const items = eqList.filter((e) => e.group === g).sort(byPos);
    sel.innerHTML = '<option value="" disabled selected>Выберите оборудование</option>' + items
      .map((e) => `<option value="${e.id}"${curEq && curEq.id === e.id ? ' selected' : ''}>${escapeHtml(e.name)}${e.mark ? ` · ${escapeHtml(e.mark)}` : ''}${e.inv ? ` (инв. ${escapeHtml(e.inv)})` : ''}</option>`)
      .join('');
    sel.disabled = !g;
  };
  const renderStatus = () => {
    document.querySelectorAll('#bd-status [data-status]').forEach((b) => b.classList.toggle('is-active', b.dataset.status === status));
    $('#bd-done-fields').hidden = status !== 'done';
  };

  if (curEq) fillEquipment();
  renderStatus();

  $('#bd-group').addEventListener('change', fillEquipment);
  $('#bd-type').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-type]');
    if (!chip) return;
    type = chip.dataset.type;
    document.querySelectorAll('#bd-type .chip').forEach((c) => c.classList.toggle('is-active', c === chip));
  });
  $('#bd-status').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    status = btn.dataset.status;
    renderStatus();
  });
}

function saveBreakdown(bd, { status, type }) {
  const error = (msg, field) => fieldError(field, msg, '#bd-error');
  const equipmentId = $('#bd-eq').value;
  const startVal = $('#bd-start').value;
  const reason = $('#bd-reason').value.trim();

  if (!equipmentId) return error('Выберите оборудование.', $('#bd-eq').disabled ? '#bd-group' : '#bd-eq');
  if (!startVal) return error('Укажите время начала остановки.', '#bd-start');
  if (!reason) return error('Опишите причину остановки.', '#bd-reason');
  if (!type) return error('Выберите тип поломки.', '#bd-type');

  const start = new Date(startVal);
  let end = null;
  let repairedBy = '';
  let used = [];
  const oldUsed = bd?.used || [];
  if (status === 'done') {
    const endVal = $('#bd-end').value;
    repairedBy = $('#bd-by').value.trim();
    if (!endVal) return error('Укажите время окончания ремонта.', '#bd-end');
    end = new Date(endVal);
    if (end < start) return error('Окончание ремонта не может быть раньше начала остановки.', '#bd-end');
    if (!repairedBy) return error('Укажите, кто закончил ремонт.', '#bd-by');
    const res = readUsed($('#bd-done-fields [data-used-editor]'), oldUsed);
    if (res.error) return error(res.error, '#bd-done-fields [data-used-editor]');
    used = res.used;
  }

  const fields = {
    equipmentId, reason, type, status,
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    repairedBy,
    used, // вернули в ремонт — запчасти возвращаются на склад
  };

  DB.update((d) => {
    applyUsage(d, oldUsed, used);
    const found = bd && d.breakdowns.find((x) => x.id === bd.id);
    if (found) Object.assign(found, fields);
    else d.breakdowns.push({
      id: uid(),
      shiftId: d.currentShift?.id || null,
      master: d.currentShift?.master || '',
      ...fields,
    });
  });
}

function confirmDeleteBreakdown(bd) {
  openModal('Удалить поломку?', `
    <p>Запись о поломке <b>${escapeHtml(equipmentName(bd.equipmentId))}</b> от ${fmtDateTime(bd.start)} будет удалена без возможности восстановления.</p>
    ${returnNote(bd.used)}`, [
    { label: 'Отмена' },
    {
      label: 'Удалить', danger: true,
      onClick: () => DB.update((d) => {
        applyUsage(d, bd.used || [], []);
        d.breakdowns = d.breakdowns.filter((x) => x.id !== bd.id);
      }),
    },
  ]);
}

// Удаление смены из истории: уходят и её собственные поломки (списанные запчасти возвращаются на склад).
// Смену с поломкой, которая ещё в ремонте, удалить нельзя: станок «выздоровел» бы сам собой.
function confirmDeleteShift(sh) {
  if (!sh) return;
  const own = DB.data.breakdowns.filter((b) => b.shiftId === sh.id);
  const inRepair = own.filter((b) => b.status === 'repair');
  const label = `${SETTINGS().shiftTypes[sh.type]?.label || ''} смена · ${shiftDays(new Date(sh.start), new Date(sh.end))}`;
  if (inRepair.length) {
    openModal('Смену удалить нельзя', `
      <p>В смене <b>${escapeHtml(label)}</b> есть поломки, которые ещё в ремонте:
         ${inRepair.map((b) => `<b>${escapeHtml(equipmentName(b.equipmentId))}</b>`).join(', ')}.</p>
      <p class="muted">Сначала закройте ремонт или удалите эти поломки, потом удалите смену.</p>`,
      [{ label: 'Понятно', primary: true }]);
    return;
  }
  const returns = own.some((b) => (b.used || []).some((u) => u.partId));
  openModal('Удалить смену?', `
    <p>Смена <b>${escapeHtml(label)}</b>, мастер <b>${escapeHtml(sh.master)}</b>${sh.number ? `, № ${escapeHtml(sh.number)}` : ''},
       будет удалена без возможности восстановления.</p>
    <p class="muted">Вместе с ней удалятся её поломки: ${own.length}.${returns ? ' Списанные ими запчасти вернутся на склад.' : ''}</p>`, [
    { label: 'Отмена' },
    {
      label: 'Удалить', danger: true,
      onClick: () => DB.update((d) => {
        for (const b of own) applyUsage(d, b.used || [], []);
        d.breakdowns = d.breakdowns.filter((b) => b.shiftId !== sh.id);
        d.shifts = d.shifts.filter((x) => x.id !== sh.id);
      }),
    },
  ]);
}

// При удалении записи списанные ею запчасти возвращаются на склад.
const returnNote = (used = []) => (used.some((u) => u.partId)
  ? '<p class="muted">Списанные по ней запчасти вернутся на склад.</p>' : '');

// ================= Необходимый ремонт =================
// Заявка: { id, equipmentId, type, description, author, createdAt, shiftId,
//           status: 'open' | 'done', doneAt, doneBy }

// Подсказки фамилий: мастера + все, кто уже фигурировал в записях.
const knownPeople = () => [...new Set([
  ...masterNames(),
  ...DB.data.repairs.flatMap((r) => [r.author, r.doneBy]),
  ...DB.data.breakdowns.map((b) => b.repairedBy),
].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));

function repairCard(r, clickable = true) {
  const done = r.status === 'done';
  const eq = DB.data.equipment.find((e) => e.id === r.equipmentId);
  const waiting = fmtDuration((done ? new Date(r.doneAt) : new Date()) - new Date(r.createdAt));
  const tag = clickable ? 'button' : 'div';
  return `
    <${tag} class="bd-item rq-item rq-item--${done ? 'done' : 'open'}"${clickable ? ` data-rq="${r.id}"` : ''}>
      <span class="bd-item__head">
        <span class="bd-item__name">${escapeHtml(equipmentName(r.equipmentId))}${eq?.mark ? ` <span class="bd-item__mark">${escapeHtml(eq.mark)}</span>` : ''}</span>
        ${!done && r.priority === 'urgent' ? '<span class="bd-status bd-status--urgent">▲ Срочно</span>' : ''}
        <span class="bd-status bd-status--${done ? 'done' : 'wait'}">${done ? 'Выполнено' : 'Ожидает'}</span>
      </span>
      <span class="bd-item__reason">${escapeHtml(r.description)}</span>
      <span class="bd-item__meta">
        <span>${escapeHtml(r.type)}</span>
        <span>Создана: <b>${fmtDateTime(r.createdAt)}</b></span>
        <span>Составил: <b>${escapeHtml(r.author)}</b></span>
        <span>${done ? 'Выполнена за' : 'Ожидает'}: <b>${waiting}</b></span>
        ${done ? `<span>Выполнил: <b>${escapeHtml(r.doneBy)}</b> ${fmtDateTime(r.doneAt)}</span>` : ''}
      </span>
      ${done ? usedLine(r.used, r.usedNote) : ''}
    </${tag}>`;
}

function repairView() {
  const all = DB.data.repairs;
  // Срочные — первыми, внутри — от старых к новым.
  const urgent = (r) => (r.priority === 'urgent' ? 0 : 1);
  const open = all.filter((r) => r.status !== 'done').sort((a, b) => urgent(a) - urgent(b) || a.createdAt.localeCompare(b.createdAt));
  const done = all.filter((r) => r.status === 'done').sort((a, b) => b.doneAt.localeCompare(a.doneAt)).slice(0, 20);
  if (!all.length) {
    return `
      <div class="empty">
        <div class="empty__icon">${ICONS.repair}</div>
        <p>Заявок на ремонт нет.</p>
        ${state.viewer ? '' : '<p class="muted">Чтобы добавить заявку, нажмите «Заявка» внизу справа.</p>'}
      </div>`;
  }
  const section = (title, list) => list.length
    ? `<section class="bd-section"><h3 class="eq-group__title">${title}</h3><div class="bd-list">${list.map((r) => withTrash(repairCard(r), r, 'repair')).join('')}</div></section>`
    : '';
  return (open.length ? '' : '<p class="muted">Открытых заявок нет.</p>')
    + section(`Ожидают ремонта · ${open.length}`, open)
    + section('Выполненные (последние 20)', done);
}

// Нажатие на заявку: в режиме настроек — правка; иначе открытую можно отметить выполненной.
function openRepair(r) {
  if (state.admin) return openRepairForm(r);
  if (r.status === 'done' || state.viewer) {
    openModal('Заявка на ремонт', `<div class="bd-list">${repairCard(r, false)}</div>`, [
      { label: 'Закрыть', primary: true },
    ]);
    return;
  }
  openModal('Заявка на ремонт', `
    <div class="bd-list">${repairCard(r, false)}</div>
    <h4 class="modal__sub">Отметить выполненной</h4>
    <label class="field">
      <span class="field__label">Кто выполнил ремонт</span>
      <input id="rq-done-by" list="rq-people" autocomplete="off" placeholder="Фамилия">
      <datalist id="rq-people">${knownPeople().map((n) => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
    </label>
    ${usedField()}
    <p class="error" id="rq-error" aria-live="polite" hidden></p>`, [
    { label: 'Закрыть' },
    { label: 'Выполнено', primary: true, onClick: () => completeRepair(r) },
  ], { fill: true });
}

// Выполнение заявки: проверяем запчасти, списываем со склада, закрываем заявку — одним изменением.
function completeRepair(r) {
  const error = (msg, field) => fieldError(field, msg, '#rq-error');
  const by = $('#rq-done-by').value.trim();
  if (!by) return error('Укажите, кто выполнил ремонт.', '#rq-done-by');
  const res = readUsed($('#modal-body [data-used-editor]'));
  if (res.error) return error(res.error, '#modal-body [data-used-editor]');

  DB.update((d) => {
    applyUsage(d, [], res.used);
    Object.assign(d.repairs.find((x) => x.id === r.id), {
      status: 'done', doneBy: by, doneAt: new Date().toISOString(), used: res.used,
    });
  });
}

// ================= Использованные запчасти =================
// Один блок для поломки, заявки и закрытия ремонта в конце смены.
// Запись: { partId, name, article, qty, unit }; partId = null — «Другое», не со склада (не списывается).
const USED_OTHER = '__other__';

const usedField = (used = [], label = 'Использованные запчасти') => `
  <div class="field">
    <span class="field__label">${label}</span>
    <div class="used-editor" data-used-editor>
      <div class="used-list">${used.map(usedRow).join('')}</div>
      <button type="button" class="btn used-add" data-used-add>+ Добавить запчасть</button>
    </div>
    <span class="used-hint">Запчасти со склада спишутся. Если нужной нет в списке — «Другое».</span>
  </div>`;

function usedRow(u = null) {
  const parts = DB.data.parts;
  const other = !!u && !u.partId;
  const part = u?.partId ? parts.find((p) => p.id === u.partId) : null;
  const groups = [...new Set(parts.map((p) => p.group))].sort(byRu);
  const opts = groups.map((g) => `
    <optgroup label="${escapeHtml(g)}">
      ${parts.filter((p) => p.group === g).sort((a, b) => byRu(a.name, b.name)).map((p) => `
        <option value="${p.id}"${part?.id === p.id ? ' selected' : ''}>${escapeHtml(p.name)}${p.article ? ` (${escapeHtml(p.article)})` : ''} — есть ${fmtQty(p.qty)} ${escapeHtml(p.unit)}</option>`).join('')}
    </optgroup>`).join('');
  const unit = u?.unit || CONFIG.units[0];
  return `
    <div class="used-row${other ? ' is-other' : ''}">
      <select data-used-part aria-label="Запчасть">
        <option value="" disabled${u ? '' : ' selected'}>Выберите запчасть</option>
        ${opts}
        <option value="${USED_OTHER}"${other ? ' selected' : ''}>Другое (нет в списке)…</option>
      </select>
      <input type="number" data-used-qty min="0" step="any" inputmode="decimal" placeholder="Кол-во" aria-label="Количество" value="${u ? u.qty : ''}">
      <span class="used-unit" data-used-unit-label>${part ? escapeHtml(part.unit) : ''}</span>
      <select class="used-unit-sel" data-used-unit aria-label="Единица">
        ${CONFIG.units.map((x) => `<option${x === unit ? ' selected' : ''}>${x}</option>`).join('')}
      </select>
      <button type="button" class="trash trash--sm" data-used-del title="Убрать" aria-label="Убрать">${ICONS.trash}</button>
      <input class="used-name" data-used-name autocomplete="off" placeholder="Название запчасти" value="${other ? escapeHtml(u.name) : ''}">
    </div>`;
}

// Окно одно на всё приложение — обработчики блока вешаем один раз.
$('#modal').addEventListener('click', (e) => {
  const add = e.target.closest('[data-used-add]');
  if (add) {
    const list = add.closest('[data-used-editor]').querySelector('.used-list');
    list.insertAdjacentHTML('beforeend', usedRow());
    list.lastElementChild.querySelector('select').focus();
  }
  if (e.target.closest('[data-used-del]')) e.target.closest('.used-row').remove();
});
$('#modal').addEventListener('change', (e) => {
  if (e.target.dataset.usedPart === undefined) return;
  const row = e.target.closest('.used-row');
  const other = e.target.value === USED_OTHER;
  row.classList.toggle('is-other', other);
  const part = DB.data.parts.find((p) => p.id === e.target.value);
  row.querySelector('[data-used-unit-label]').textContent = part ? part.unit : '';
  (other ? row.querySelector('[data-used-name]') : row.querySelector('[data-used-qty]')).focus();
});

// Считывает строки блока. oldUsed — что было списано этой записью раньше (при правке):
// это количество «возвращается» перед проверкой остатка. reserved — уже занято другими строками
// того же окна (несколько ремонтов закрываются разом).
function readUsed(editor, oldUsed = [], reserved = []) {
  const used = [];
  if (!editor) return { used };
  for (const row of editor.querySelectorAll('.used-row')) {
    const sel = row.querySelector('[data-used-part]').value;
    const qty = Number(row.querySelector('[data-used-qty]').value);
    if (!sel) return { error: 'Выберите запчасть в каждой строке или уберите пустую строку.' };
    if (sel === USED_OTHER) {
      const name = row.querySelector('[data-used-name]').value.trim();
      if (!name) return { error: 'Для «Другое» напишите название запчасти.' };
      if (!(qty > 0)) return { error: `«${name}»: укажите количество больше нуля.` };
      used.push({ partId: null, name, article: '', qty: roundQty(qty), unit: row.querySelector('[data-used-unit]').value });
      continue;
    }
    const part = DB.data.parts.find((p) => p.id === sel);
    if (!part) return { error: 'Запчасть удалена со склада — выберите другую.' };
    if (!(qty > 0)) return { error: `«${part.name}»: укажите количество больше нуля.` };
    const sum = (list) => list.filter((u) => u.partId === part.id).reduce((n, u) => n + u.qty, 0);
    const available = roundQty(part.qty + sum(oldUsed) - sum(reserved));
    if (sum(used) + qty > available) return { error: `«${part.name}»: на складе только ${fmtQty(available)} ${part.unit}.` };
    used.push({ partId: part.id, name: part.name, article: part.article || '', qty: roundQty(qty), unit: part.unit });
  }
  return { used };
}

// Возвращает на склад прежнее списание и списывает новое. Вызывать внутри DB.update.
function applyUsage(d, oldUsed = [], newUsed = []) {
  const move = (list, sign) => list.forEach((u) => {
    const p = u.partId && d.parts.find((x) => x.id === u.partId);
    if (p) p.qty = roundQty(p.qty + sign * u.qty);
  });
  move(oldUsed, +1);
  move(newUsed, -1);
}

// Строка «Использовано: …» в карточках поломок и заявок.
function usedLine(used = [], note = '') {
  if (!used.length && !note) return '';
  return `
    <span class="rq-used">
      <span class="rq-used__label">Использовано:</span>
      ${used.map((u) => `<span class="rq-used__item">${escapeHtml(u.name)}${u.article ? ` (${escapeHtml(u.article)})` : ''} — <b>${fmtQty(u.qty)} ${escapeHtml(u.unit)}</b>${u.partId ? '' : ' <i class="muted">не со склада</i>'}</span>`).join('')}
      ${note ? `<span class="rq-used__item">${escapeHtml(note)}</span>` : ''}
    </span>`;
}

function openRepairForm(r = null) {
  const eqList = DB.data.equipment;
  if (!eqList.length) {
    openModal('Заявка на ремонт', '<p>В перечне ещё нет оборудования.</p><p class="muted">Сначала добавьте его во вкладке «Перечень оборудования» в режиме настроек.</p>', [
      { label: 'Понятно', primary: true },
    ]);
    return;
  }
  const curEq = r && eqList.find((e) => e.id === r.equipmentId);
  let type = r ? r.type : '';
  let priority = r?.priority || 'planned';
  const author = r ? r.author : DB.data.currentShift?.master || '';

  openModal(r ? 'Заявка на ремонт' : 'Новая заявка на ремонт', `
    <label class="field">
      <span class="field__label">Подгруппа</span>
      <select id="rq-group">
        <option value="" disabled${curEq ? '' : ' selected'}>Выберите подгруппу</option>
        ${getGroups().map((g) => `<option${curEq && curEq.group === g ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('')}
      </select>
    </label>
    <label class="field">
      <span class="field__label">Оборудование</span>
      <select id="rq-eq"${curEq ? '' : ' disabled'}></select>
    </label>
    <div class="field">
      <span class="field__label">Тип работ</span>
      <div class="chips" id="rq-type">
        ${CONFIG.breakdownTypes.map((v) => `<button type="button" class="chip${v === type ? ' is-active' : ''}" data-type="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <span class="field__label">Приоритет</span>
      <div class="segmented" id="rq-priority">
        <button type="button" class="segmented__btn${priority === 'planned' ? ' is-active' : ''}" data-priority="planned">Планово</button>
        <button type="button" class="segmented__btn${priority === 'urgent' ? ' is-active' : ''}" data-priority="urgent">Срочно</button>
      </div>
    </div>
    <label class="field">
      <span class="field__label">Что нужно сделать</span>
      <textarea id="rq-desc" rows="3" placeholder="Описание работ">${r ? escapeHtml(r.description) : ''}</textarea>
    </label>
    <label class="field">
      <span class="field__label">Кто составил заявку</span>
      <input id="rq-author" list="rq-people" autocomplete="off" placeholder="Фамилия" value="${escapeHtml(author)}">
      <datalist id="rq-people">${knownPeople().map((n) => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
    </label>
    ${r ? '' : `<div class="field"><span class="field__label">Дата заявки</span><div class="field__auto">${fmtDateTime(new Date().toISOString())}</div></div>`}
    <p class="error" id="rq-error" aria-live="polite" hidden></p>`, [
    { label: 'Отмена' },
    { label: 'Сохранить', primary: true, onClick: () => saveRepair(r, type, priority) },
  ], { fill: true });

  $('#rq-priority').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-priority]');
    if (!btn) return;
    priority = btn.dataset.priority;
    document.querySelectorAll('#rq-priority [data-priority]').forEach((b) => b.classList.toggle('is-active', b === btn));
  });

  const fillEquipment = () => {
    const g = $('#rq-group').value;
    const items = eqList.filter((e) => e.group === g).sort(byPos);
    $('#rq-eq').innerHTML = '<option value="" disabled selected>Выберите оборудование</option>' + items
      .map((e) => `<option value="${e.id}"${curEq && curEq.id === e.id ? ' selected' : ''}>${escapeHtml(e.name)}${e.mark ? ` · ${escapeHtml(e.mark)}` : ''}${e.inv ? ` (инв. ${escapeHtml(e.inv)})` : ''}</option>`)
      .join('');
    $('#rq-eq').disabled = !g;
  };
  if (curEq) fillEquipment();
  $('#rq-group').addEventListener('change', fillEquipment);
  $('#rq-type').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-type]');
    if (!chip) return;
    type = chip.dataset.type;
    document.querySelectorAll('#rq-type .chip').forEach((c) => c.classList.toggle('is-active', c === chip));
  });
}

function saveRepair(r, type, priority = 'planned') {
  const error = (msg, field) => fieldError(field, msg, '#rq-error');
  const equipmentId = $('#rq-eq').value;
  const description = $('#rq-desc').value.trim();
  const author = $('#rq-author').value.trim();
  if (!equipmentId) return error('Выберите оборудование.', $('#rq-eq').disabled ? '#rq-group' : '#rq-eq');
  if (!type) return error('Выберите тип работ.', '#rq-type');
  if (!description) return error('Опишите, что нужно сделать.', '#rq-desc');
  if (!author) return error('Укажите, кто составил заявку.', '#rq-author');

  DB.update((d) => {
    const found = r && d.repairs.find((x) => x.id === r.id);
    if (found) Object.assign(found, { equipmentId, type, description, author, priority });
    else d.repairs.push({
      id: uid(), equipmentId, type, description, author, priority,
      createdAt: new Date().toISOString(),
      shiftId: d.currentShift?.id || null,
      status: 'open', doneAt: null, doneBy: '',
    });
  });
}

function confirmDeleteRepair(r) {
  openModal('Удалить заявку?', `
    <p>Заявка на ремонт <b>${escapeHtml(equipmentName(r.equipmentId))}</b> от ${fmtDateTime(r.createdAt)} будет удалена без возможности восстановления.</p>
    ${returnNote(r.used)}`, [
    { label: 'Отмена' },
    {
      label: 'Удалить', danger: true,
      onClick: () => DB.update((d) => {
        applyUsage(d, r.used || [], []);
        d.repairs = d.repairs.filter((x) => x.id !== r.id);
      }),
    },
  ]);
}

// ================= Склад =================
// Запчасть: { id, group, kind, name, article, qty, unit, min }
// Минимум достигнут, когда остаток ≤ минимального (минимум 0 — без контроля).

const fmtQty = (n) => (Number.isInteger(n) ? String(n) : n.toLocaleString('ru-RU', { maximumFractionDigits: 3 }));
const roundQty = (n) => Math.round(n * 1000) / 1000;
const isLow = (p) => p.min > 0 && p.qty <= p.min;
const byRu = (a, b) => a.localeCompare(b, 'ru');

function partRow(p, showPath = false) {
  const low = isLow(p);
  return `
    <button class="pt-row${low ? ' is-low' : ''}" data-part="${p.id}">
      <span class="pt-row__name">
        <span class="bd-item__name">${escapeHtml(p.name)}${p.article ? ` <span class="bd-item__mark">${escapeHtml(p.article)}</span>` : ''}</span>
        ${showPath ? `<span class="eq-row__sub">${escapeHtml(p.group)} · ${escapeHtml(p.kind)}</span>` : ''}
      </span>
      <span class="pt-row__qty">${low ? '<span class="warn-icon" aria-hidden="true">!</span>' : ''}<b>${fmtQty(p.qty)}</b> ${escapeHtml(p.unit)}</span>
      <span class="pt-row__min">${p.min > 0 ? `мин. ${fmtQty(p.min)}` : 'без мин.'}</span>
    </button>`;
}

function warehouseView() {
  const parts = DB.data.parts;
  if (!parts.length) {
    return `
      <div class="empty">
        <div class="empty__icon">${ICONS.warehouse}</div>
        <p>Склад пуст.</p>
        <p class="muted">${state.admin ? 'Чтобы добавить запчасть, нажмите «Запчасть» внизу справа.' : 'Запчасти добавляются в режиме настроек.'}</p>
      </div>`;
  }
  const editing = state.admin && state.editing;
  const row = (p, path) => withTrash(partRow(p, path), p, 'part');
  const low = parts.filter(isLow).sort((a, b) => a.qty / a.min - b.qty / b.min);

  const tiles = `
    <div class="stat-row">
      ${statTile('Позиций на складе', parts.length)}
      ${statTile('Достигли минимума', low.length, low.length ? 'warn' : '')}
    </div>`;

  const lowBlock = low.length ? `
    <section class="eq-group pt-low">
      <h3 class="eq-group__title">Достигли минимального остатка · ${low.length}</h3>
      <div class="eq-rows">${low.map((p) => row(p, true)).join('')}</div>
    </section>` : '';

  const groups = [...new Set(parts.map((p) => p.group))].sort(byRu);
  const body = groups.map((g) => {
    const inGroup = parts.filter((p) => p.group === g);
    const kinds = [...new Set(inGroup.map((p) => p.kind))].sort(byRu);
    return `
      <section class="eq-group">
        ${editing
          ? `<input class="pt-rename pt-rename--group" value="${escapeHtml(g)}" data-rename-group="${escapeHtml(g)}" aria-label="Название группы">`
          : `<h3 class="eq-group__title">${escapeHtml(g)}</h3>`}
        ${kinds.map((k) => `
          <div class="pt-kind">
            ${editing
              ? `<input class="pt-rename" value="${escapeHtml(k)}" data-rename-kind="${escapeHtml(k)}" data-group="${escapeHtml(g)}" aria-label="Название вида">`
              : `<h4 class="pt-kind__title">${escapeHtml(k)}</h4>`}
            <div class="eq-rows">${inGroup.filter((p) => p.kind === k).sort((a, b) => byRu(a.name, b.name)).map((p) => row(p)).join('')}</div>
          </div>`).join('')}
      </section>`;
  }).join('');

  return tiles + lowBlock + body;
}

// Карточка запчасти для просмотра: данные + где расходовалась.
function openPartInfo(p) {
  // Расход по поломкам и заявкам: { at, equipmentId, by, qty, src }.
  const take = (list, src, at, by) => list
    .filter((x) => x.status === 'done' && x.used?.some((u) => u.partId === p.id))
    .map((x) => ({ at: x[at], equipmentId: x.equipmentId, by: x[by], src,
      qty: x.used.filter((u) => u.partId === p.id).reduce((n, u) => n + u.qty, 0) }));
  const usage = [...take(DB.data.breakdowns, 'поломка', 'end', 'repairedBy'), ...take(DB.data.repairs, 'заявка', 'doneAt', 'doneBy')]
    .sort((a, b) => b.at.localeCompare(a.at));
  openModal(p.name, `
    <div class="eq-info">
      <span>Группа: <b>${escapeHtml(p.group)}</b></span>
      <span>Вид: <b>${escapeHtml(p.kind)}</b></span>
      ${p.article ? `<span>Артикул: <b>${escapeHtml(p.article)}</b></span>` : ''}
    </div>
    <div class="stat-row stat-row--compact">
      ${statTile('Остаток', `${fmtQty(p.qty)} ${escapeHtml(p.unit)}`, isLow(p) ? 'warn' : '')}
      ${statTile('Минимальный остаток', p.min > 0 ? `${fmtQty(p.min)} ${escapeHtml(p.unit)}` : '—')}
    </div>
    ${isLow(p) ? '<p class="pt-warn">Остаток достиг минимального — нужно пополнить.</p>' : ''}
    <h4 class="modal__sub">Расход</h4>
    ${usage.length ? `<ul class="ho-log">${usage.map((u) =>
      `<li>${fmtDateTime(u.at)} — ${escapeHtml(equipmentName(u.equipmentId))}, ${u.src}: <b>${fmtQty(u.qty)} ${escapeHtml(p.unit)}</b> (${escapeHtml(u.by)})</li>`
    ).join('')}</ul>` : '<p class="muted">Ещё не расходовалась.</p>'}`, [
    { label: 'Закрыть', primary: true },
  ]);
}

// Выпадающий список с вариантом «+ Новая…» и полем для нового значения.
function pickOrNew(id, label, values, current, newLabel) {
  return `
    <label class="field">
      <span class="field__label">${label}</span>
      <select id="${id}">
        ${values.length && !current ? `<option value="" disabled selected>Выберите</option>` : ''}
        ${values.map((v) => `<option${v === current ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}
        <option value="${NEW_GROUP}"${values.length ? '' : ' selected'}>+ ${newLabel}…</option>
      </select>
    </label>
    <label class="field" id="${id}-new-wrap"${values.length ? ' hidden' : ''}>
      <span class="field__label">${newLabel}: название</span>
      <input id="${id}-new" autocomplete="off">
    </label>`;
}
const pickedValue = (id) => ($(`#${id}`).value === NEW_GROUP ? $(`#${id}-new`).value.trim() : $(`#${id}`).value);
function bindPickOrNew(id, onChange) {
  $(`#${id}`).addEventListener('change', (e) => {
    const isNew = e.target.value === NEW_GROUP;
    $(`#${id}-new-wrap`).hidden = !isNew;
    if (isNew) $(`#${id}-new`).focus();
    onChange?.();
  });
}

function openPartForm(p = null) {
  const parts = DB.data.parts;
  const groups = [...new Set(parts.map((x) => x.group))].sort(byRu);
  const kindsOf = (g) => [...new Set(parts.filter((x) => x.group === g).map((x) => x.kind))].sort(byRu);
  const units = CONFIG.units;

  openModal(p ? 'Изменить запчасть' : 'Добавить запчасть на склад', `
    ${pickOrNew('pt-group', 'Группа запчастей', groups, p?.group, 'Новая группа')}
    <div id="pt-kind-box">${pickOrNew('pt-kind', 'Вид', p ? kindsOf(p.group) : [], p?.kind, 'Новый вид')}</div>
    <label class="field">
      <span class="field__label">Наименование</span>
      <input id="pt-name" autocomplete="off" value="${p ? escapeHtml(p.name) : ''}">
    </label>
    <label class="field">
      <span class="field__label">Артикул / маркировка</span>
      <input id="pt-article" autocomplete="off" value="${p ? escapeHtml(p.article || '') : ''}" placeholder="Необязательно">
    </label>
    <div class="pt-nums">
      <label class="field">
        <span class="field__label">Количество</span>
        <input id="pt-qty" type="number" min="0" step="any" inputmode="decimal" value="${p ? p.qty : ''}">
      </label>
      <label class="field">
        <span class="field__label">Единица</span>
        <select id="pt-unit">${units.map((u) => `<option${(p?.unit || units[0]) === u ? ' selected' : ''}>${u}</option>`).join('')}</select>
      </label>
    </div>
    <label class="field">
      <span class="field__label">Минимальный остаток</span>
      <input id="pt-min" type="number" min="0" step="any" inputmode="decimal" value="${p ? p.min : ''}" placeholder="0 — без контроля">
    </label>
    <p class="muted pt-hint">Когда остаток станет равен минимальному или меньше, позиция подсветится жёлтым и встанет в начало списка, а на вкладке «Склад» появится жёлтый счётчик.</p>
    <p class="error" id="pt-error" aria-live="polite" hidden></p>`, [
    { label: 'Отмена' },
    { label: 'Сохранить', primary: true, onClick: () => savePart(p) },
  ], { fill: true });

  // Виды зависят от группы: пока группа не выбрана — подсказка; новая группа — сразу новый вид.
  const refreshKinds = () => {
    const sel = $('#pt-group').value;
    if (!sel) {
      $('#pt-kind-box').innerHTML = `
        <label class="field"><span class="field__label">Вид</span>
          <select id="pt-kind" disabled><option>Сначала выберите группу</option></select></label>`;
      return;
    }
    const g = sel === NEW_GROUP ? '' : sel;
    $('#pt-kind-box').innerHTML = pickOrNew('pt-kind', 'Вид', g ? kindsOf(g) : [], '', 'Новый вид');
    bindPickOrNew('pt-kind');
  };
  bindPickOrNew('pt-group', refreshKinds);
  if (p) bindPickOrNew('pt-kind'); else refreshKinds();
}

function savePart(p) {
  const error = (msg, field) => fieldError(field, msg, '#pt-error');
  const group = pickedValue('pt-group');
  const kind = pickedValue('pt-kind');
  const name = $('#pt-name').value.trim();
  const article = $('#pt-article').value.trim();
  const qtyRaw = $('#pt-qty').value, minRaw = $('#pt-min').value;
  const qty = Number(qtyRaw), min = minRaw === '' ? 0 : Number(minRaw);
  const unit = $('#pt-unit').value;

  if (!group) return error('Укажите группу запчастей.', $('#pt-group').value === NEW_GROUP ? '#pt-group-new' : '#pt-group');
  if (!kind) return error('Укажите вид.', $('#pt-kind').value === NEW_GROUP ? '#pt-kind-new' : '#pt-kind');
  if (!name) return error('Укажите наименование.', '#pt-name');
  if (qtyRaw === '' || !(qty >= 0)) return error('Укажите количество (0 или больше).', '#pt-qty');
  if (!(min >= 0)) return error('Минимальный остаток не может быть отрицательным.', '#pt-min');
  const dup = DB.data.parts.some((x) => x.id !== p?.id && x.group === group && x.kind === kind
    && x.name.toLowerCase() === name.toLowerCase() && (x.article || '') === article);
  if (dup) return error('Такая запчасть уже есть на складе — измените её количество.', '#pt-name');

  const fields = { group, kind, name, article, qty: roundQty(qty), unit, min: roundQty(min) };
  DB.update((d) => {
    const found = p && d.parts.find((x) => x.id === p.id);
    if (found) Object.assign(found, fields);
    else d.parts.push({ id: uid(), ...fields });
  });
}

function confirmDeletePart(p) {
  openModal('Удалить запчасть?', `
    <p>Позиция <b>${escapeHtml(p.name)}</b> (${fmtQty(p.qty)} ${escapeHtml(p.unit)}) будет удалена со склада без возможности восстановления.</p>
    <p class="muted">Записи о расходе в выполненных заявках сохранятся.</p>`, [
    { label: 'Отмена' },
    { label: 'Удалить', danger: true, onClick: () => DB.update((d) => { d.parts = d.parts.filter((x) => x.id !== p.id); }) },
  ]);
}

// Переименование группы / вида в режиме редактирования — сразу для всех позиций.
$('#panel').addEventListener('change', (e) => {
  const el = e.target;
  const v = el.value.trim();
  if (el.dataset.renameGroup !== undefined) {
    if (!v) { el.value = el.dataset.renameGroup; return; }
    DB.update((d) => { d.parts.forEach((p) => { if (p.group === el.dataset.renameGroup) p.group = v; }); });
  }
  if (el.dataset.renameKind !== undefined) {
    if (!v) { el.value = el.dataset.renameKind; return; }
    DB.update((d) => {
      d.parts.forEach((p) => { if (p.group === el.dataset.group && p.kind === el.dataset.renameKind) p.kind = v; });
    });
  }
});

$('#fab').addEventListener('click', () => {
  if (state.viewer) return;
  if (state.tab === 'current') return openMachinePicker();
  if (state.tab === 'repair') return openRepairForm();
  if (state.tab === 'warehouse') return state.admin && openPartForm();
});

// ================= Мануалы =================
// База знаний — в manuals/*.js (MANUALS_KB, kbSearch). Здесь — список и окно поиска.

const KIND_LABELS = { alarm: 'Авария', warning: 'Предупреждение', symptom: 'Неисправность' };
const kbMakers = () => [...new Set(MANUALS_KB.map((m) => m.maker))].sort(byRu);

// Поиск прямо в панели. Пока запрос пустой — список мануалов; при вводе — результаты.
// Запрос и фильтры живут в state, чтобы пережить перерисовку вкладки.
state.kb = { q: '', maker: '', manualId: '' };

function manualsView() {
  if (!MANUALS_KB.length) {
    return `
      <div class="empty">
        <div class="empty__icon">${ICONS.manuals}</div>
        <p>Мануалы ещё не добавлены.</p>
      </div>`;
  }
  const { q, maker, manualId } = state.kb;
  const manual = MANUALS_KB.find((m) => m.id === manualId);
  return `
    <div class="kb-search">
      <label class="kb-search__field">
        <span class="kb-search__icon">${ICONS.find}</span>
        <input id="kb-q" type="search" autocomplete="off" value="${escapeHtml(q)}"
          placeholder="Код ошибки или описание: E07, A.710, нет давления" aria-label="Код ошибки или описание">
        <button type="button" class="kb-search__clear" data-kb-clear title="Очистить" aria-label="Очистить"${q ? '' : ' hidden'}>✕</button>
      </label>
      <select id="kb-maker" class="kb-search__maker" aria-label="Производитель">
        <option value="">Все производители</option>
        ${kbMakers().map((mk) => `<option${mk === maker ? ' selected' : ''}>${escapeHtml(mk)}</option>`).join('')}
      </select>
    </div>
    ${manual ? `<p class="kb-filter">Только мануал: <b>${escapeHtml(manual.maker)} ${escapeHtml(manual.model)}</b> <button type="button" class="btn kb-filter__off" data-kb-all>Искать везде</button></p>` : ''}
    ${state.admin ? `<p class="pt-warn kb-admin-note">Новые мануалы добавляются через обработку: положить PDF в папку <b>мануалы-исходники/&lt;Производитель&gt;</b> и попросить Claude «обработай новые мануалы».</p>` : ''}
    <div id="kb-results" aria-live="polite">${kbResults()}</div>`;
}

// Содержимое под поиском: список мануалов или результаты запроса.
function kbResults() {
  const { q, maker, manualId } = state.kb;
  if (!q.trim()) return manualsList(maker);
  const filter = { maker: maker || undefined, manualId: manualId || undefined };
  const found = kbSearch(q, filter);
  if (!found.length) {
    return `<p class="kb-none">Ничего не найдено${maker ? ` у ${escapeHtml(maker)}` : ''}. Попробуйте другие слова или выберите «Все производители».</p>`;
  }
  const exact = found[0].score >= 1000;
  const shown = found.slice(0, 15);
  return `
    <p class="muted kb-count">${exact ? 'Найдено по коду' : 'Похожие записи'}: ${found.length}${found.length > shown.length ? `, показаны первые ${shown.length}` : ''}</p>
    <div class="kb-list">${shown.map((r, i) => kbCard(r.entry, r.manual, exact ? r.score >= 1000 : i === 0)).join('')}</div>`;
}

function manualsList(maker) {
  const list = MANUALS_KB.filter((m) => !maker || m.maker === maker);
  const total = list.reduce((n, m) => n + m.entries.length, 0);
  return `
    <p class="muted kb-summary">${list.length} ${plural(list.length, 'мануал', 'мануала', 'мануалов')} · ${total} ${plural(total, 'запись', 'записи', 'записей')} в базе</p>
    <div class="kb-manuals">
      ${[...list].sort((a, b) => byRu(a.maker, b.maker) || byRu(a.model, b.model)).map((m) => {
        const codes = m.entries.filter((e) => e.kind !== 'symptom').length;
        const symptoms = m.entries.length - codes;
        return `
        <button class="kb-manual" data-kb-manual="${m.id}">
          <span class="kb-manual__maker">${escapeHtml(m.maker)}</span>
          <span class="bd-item__name">${escapeHtml(m.title)}</span>
          <span class="eq-item__meta">
            <span>${escapeHtml(m.kind)}</span>
            <span>Модель: <b>${escapeHtml(m.model)}</b></span>
            <span>Язык: <b>${escapeHtml(m.lang)}</b></span>
          </span>
          <span class="kb-manual__nums">
            ${codes ? `<span><b>${codes}</b> ${plural(codes, 'код', 'кода', 'кодов')} ошибок</span>` : ''}
            ${symptoms ? `<span><b>${symptoms}</b> ${plural(symptoms, 'неисправность', 'неисправности', 'неисправностей')}</span>` : ''}
          </span>
        </button>`;
      }).join('')}
    </div>`;
}

// При вводе обновляется только блок результатов — поле не теряет фокус и текст.
function updateKbResults() {
  $('#kb-results').innerHTML = kbResults();
  $('[data-kb-clear]').hidden = !state.kb.q;
}

$('#panel').addEventListener('input', (e) => {
  if (e.target.id !== 'kb-q') return;
  state.kb.q = e.target.value;
  updateKbResults();
});
$('#panel').addEventListener('change', (e) => {
  if (e.target.id !== 'kb-maker') return;
  state.kb.maker = e.target.value;
  state.kb.manualId = '';
  renderTab();
});

// Ссылка на страницу оригинала работает только локально: сами PDF не публикуются.
const pdfLink = (m, page) => (location.protocol === 'file:'
  ? `<a href="мануалы-исходники/${encodeURI(m.file)}#page=${page}" target="_blank" rel="noopener">стр. ${page} оригинала</a>`
  : `стр. ${page} оригинала`);

function kbCard(entry, manual, open = true) {
  const head = `
    ${entry.code ? `<span class="kb-code">${escapeHtml(entry.code)}</span>` : ''}
    <span class="kb-card__title">${escapeHtml(entry.title)}</span>
    <span class="kb-kind kb-kind--${entry.kind}">${KIND_LABELS[entry.kind]}</span>`;
  const body = `
    <div class="kb-card__src">${escapeHtml(manual.maker)} ${escapeHtml(manual.model)} · ${pdfLink(manual, entry.page)}</div>
    <div class="kb-card__block">
      <h5>Возможные причины</h5>
      <ul>${entry.causes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    </div>
    <div class="kb-card__block">
      <h5>Что делать</h5>
      <ol>${entry.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
    </div>`;
  return `
    <details class="kb-card kb-card--${entry.kind}"${open ? ' open' : ''}>
      <summary class="kb-card__head">${head}</summary>
      ${body}
    </details>`;
}

// Просмотр всего мануала: записи свёрнуты, раскрываются по нажатию.
function openManual(m) {
  const group = (kind, title) => {
    const list = m.entries.filter((e) => (kind === 'codes' ? e.kind !== 'symptom' : e.kind === 'symptom'));
    return list.length ? `<h4 class="modal__sub">${title} · ${list.length}</h4><div class="kb-list">${list.map((e) => kbCard(e, m, false)).join('')}</div>` : '';
  };
  openModal(`${m.maker} ${m.model}`, `
    <div class="eq-info">
      <span>${escapeHtml(m.title)}</span>
      <span>Язык оригинала: <b>${escapeHtml(m.lang)}</b></span>
    </div>
    ${m.note ? `<p class="kb-note">${escapeHtml(m.note)}</p>` : ''}
    ${group('codes', 'Коды ошибок и предупреждения')}
    ${group('symptoms', 'Неисправности по признакам')}
    <p class="muted kb-file">Файл: ${escapeHtml(m.file)}</p>`, [
    // Окно закрывается, а поиск в панели ограничивается этим мануалом.
    { label: 'Найти в этом мануале', onClick: () => {
      Object.assign(state.kb, { maker: m.maker, manualId: m.id });
      setTimeout(() => { renderTab(); $('#kb-q')?.focus(); });
    } },
    { label: 'Закрыть', primary: true },
  ], { wide: true });
}

$('#panel').addEventListener('click', (e) => {
  if (e.target.closest('[data-kb-clear]')) {
    state.kb.q = '';
    $('#kb-q').value = '';
    updateKbResults();
    return $('#kb-q').focus();
  }
  if (e.target.closest('[data-kb-all]')) {
    state.kb.manualId = '';
    return renderTab();
  }
  const m = e.target.closest('[data-kb-manual]');
  if (m) openManual(MANUALS_KB.find((x) => x.id === m.dataset.kbManual));
});

// ================= Завершение смены =================
// Если есть оборудование в ремонте, по каждому нужно решить: закрыть ремонт или передать смене.
// Переданная поломка остаётся «в ремонте», а в её записи появляется отметка о передаче.
$('#btn-end-shift').addEventListener('click', () => {
  if (state.viewer) return setViewer(false);
  const open = DB.data.breakdowns
    .filter((b) => b.status === 'repair')
    .sort((a, b) => a.start.localeCompare(b.start));

  const finish = (closes = {}) => {
    const now = new Date().toISOString();
    setAdmin(false);
    DB.update((d) => {
      const shift = d.currentShift;
      for (const b of d.breakdowns) {
        if (b.status !== 'repair') continue;
        const c = closes[b.id];
        if (c) {
          applyUsage(d, [], c.used);
          Object.assign(b, { status: 'done', end: c.end, repairedBy: c.repairedBy, used: c.used });
        }
        else if (shift) (b.handovers ||= []).push({ shiftId: shift.id, master: shift.master, at: now });
      }
      if (shift) d.shifts.push({ ...shift, end: now });
      d.currentShift = null;
    });
  };

  if (!open.length) {
    openModal('Закончить смену?', '<p>Текущая смена будет закрыта.</p>', [
      { label: 'Отмена' },
      { label: 'Закончить', primary: true, onClick: () => finish() },
    ]);
    return;
  }

  const choice = {}; // id → 'close' | 'handover'
  const nowInput = toLocalInput(new Date());

  openModal('Оборудование в ремонте', `
    <p>${open.length === 1 ? 'Один станок ещё в ремонте' : `${open.length} ${plural(open.length, 'станок', 'станка', 'станков')} ещё в ремонте`}. Перед закрытием смены решите по каждому: закрыть ремонт или передать следующей смене.</p>
    <div class="handover-list">
      ${open.map((b) => {
        const eq = DB.data.equipment.find((e) => e.id === b.equipmentId);
        return `
        <div class="handover" data-ho="${b.id}">
          <div class="handover__head">
            <span class="bd-item__name">${escapeHtml(equipmentName(b.equipmentId))}${eq?.mark ? ` <span class="bd-item__mark">${escapeHtml(eq.mark)}</span>` : ''}</span>
            <span class="muted">с ${fmtDateTime(b.start)} · ${fmtDuration(Date.now() - new Date(b.start))}</span>
          </div>
          <div class="handover__reason">${escapeHtml(b.reason)}</div>
          <div class="choice">
            <button type="button" class="choice__btn choice__btn--close" data-choice="close">Закрыть ремонт</button>
            <button type="button" class="choice__btn choice__btn--handover" data-choice="handover">Передать смене</button>
          </div>
          <div class="handover__close" hidden>
            <label class="field">
              <span class="field__label">Время окончания ремонта</span>
              <input type="datetime-local" data-end value="${nowInput}">
            </label>
            <label class="field">
              <span class="field__label">Кто закончил ремонт</span>
              <input data-by list="ho-by-list" autocomplete="off" placeholder="Фамилия">
            </label>
            ${usedField()}
          </div>
        </div>`;
      }).join('')}
    </div>
    <datalist id="ho-by-list">${knownRepairers().map((n) => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
    <p class="error" id="ho-error" aria-live="polite" hidden></p>`, [
    { label: 'Отмена' },
    {
      label: 'Закончить смену',
      primary: true,
      onClick: () => {
        // Подсвечиваем карточку станка целиком.
        const error = (msg, row) => fieldError(row, msg, '#ho-error');
        const closes = {};
        for (const b of open) {
          const row = document.querySelector(`[data-ho="${b.id}"]`);
          const name = equipmentName(b.equipmentId);
          if (!choice[b.id]) return error(`Выберите, что делать с «${name}».`, row);
          if (choice[b.id] !== 'close') continue;
          const endVal = row.querySelector('[data-end]').value;
          const by = row.querySelector('[data-by]').value.trim();
          if (!endVal) return error(`«${name}»: укажите время окончания ремонта.`, row);
          const end = new Date(endVal);
          if (end < new Date(b.start)) return error(`«${name}»: окончание ремонта раньше начала остановки.`, row);
          if (!by) return error(`«${name}»: укажите, кто закончил ремонт.`, row);
          const res = readUsed(row.querySelector('[data-used-editor]'), [], Object.values(closes).flatMap((c) => c.used));
          if (res.error) return error(`«${name}»: ${res.error}`, row);
          closes[b.id] = { end: end.toISOString(), repairedBy: by, used: res.used };
        }
        finish(closes);
      },
    },
  ], { wide: true });

  $('#modal-body .handover-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-choice]');
    if (!btn) return;
    const row = btn.closest('[data-ho]');
    choice[row.dataset.ho] = btn.dataset.choice;
    row.querySelectorAll('[data-choice]').forEach((x) => x.classList.toggle('is-active', x === btn));
    row.querySelector('.handover__close').hidden = btn.dataset.choice !== 'close';
    row.classList.toggle('is-decided', true);
    if (btn.dataset.choice === 'close') row.querySelector('[data-by]').focus();
  });
});

// ================= Тема =================
// Выбор хранится на устройстве: 'auto' | 'light' | 'dark'.
// Авто: идёт смена — по её типу (ночная → тёмная); смены нет — по расписанию на текущий час.
const THEMES = [
  { id: 'auto', label: 'Авто' },
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
];

function applyTheme() {
  const pref = store.get('theme', 'auto');
  const shift = DB.data.currentShift;
  const night = pref === 'dark' || (pref === 'auto' && (shift ? shift.type === 'night' : currentShiftType() === 'night'));
  document.body.classList.toggle('theme-night', night);
  // Цвет системной панели браузера — под фон текущей темы.
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(document.body).getPropertyValue('--bg').trim());
}

const themeSwitch = () => {
  const pref = store.get('theme', 'auto');
  return `
    <div class="field">
      <span class="field__label">Тема</span>
      <div class="segmented" id="theme-switch">
        ${THEMES.map((t) => `<button type="button" class="segmented__btn${t.id === pref ? ' is-active' : ''}" data-theme="${t.id}">${t.label}</button>`).join('')}
      </div>
      <span class="used-hint">«Авто» — тёмная тема в ночную смену.</span>
    </div>`;
};

// Окно одно на всё приложение — переключатель темы обрабатываем делегированием.
$('#modal').addEventListener('click', (e) => {
  const btn = e.target.closest('#theme-switch [data-theme]');
  if (!btn) return;
  store.set('theme', btn.dataset.theme);
  document.querySelectorAll('#theme-switch [data-theme]').forEach((b) => b.classList.toggle('is-active', b === btn));
  applyTheme();
});

// ================= Настройки =================
// Кнопка «Настройки»: настройки устройства (тема) — всем, включая зрителя;
// вход в режим настроек — по логину и паролю.
$('#btn-settings').addEventListener('click', () => {
  if (!state.admin) {
    openModal('Настройки', themeSwitch(), [
      ...(state.viewer ? [] : [{ label: 'Режим настроек', onClick: () => { openLogin(); return false; } }]),
      { label: 'Закрыть', primary: true },
    ]);
    return;
  }

  const d = DB.data;
  const updated = d.updatedAt ? new Date(d.updatedAt) : null;
  openModal('Настройки', `
    ${themeSwitch()}
    <section class="data-box">
      <h4 class="data-box__title">Файл данных</h4>
      <p class="muted">
        Изменён: ${updated ? `${fmtDate(updated)} ${fmtTime(updated)}` : 'ещё не изменялся'}<br>
        Оборудования: ${d.equipment.length} · Смен в истории: ${d.shifts.length}
      </p>
      <div class="data-box__actions">
        <button class="btn" id="btn-export">Скачать</button>
        <button class="btn" id="btn-import">Загрузить</button>
      </div>
    </section>
    <ul class="settings-list">
      <li>Группы и виды запчастей</li>
    </ul>
    <p class="muted">Эти разделы настроек будут добавлены позже.</p>`, [
    { label: 'Выйти из настроек', onClick: () => setAdmin(false) },
    { label: 'Закрыть', primary: true },
  ]);
  $('#btn-export').addEventListener('click', () => DB.exportFile());
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
});

function openLogin() {
  openModal('Вход в режим настроек', `
    <label class="field"><span class="field__label">Логин</span><input id="m-login" autocomplete="off"></label>
    <label class="field"><span class="field__label">Пароль</span><input id="m-pass" type="password"></label>
    <p class="error" id="m-error" hidden>Неверный логин или пароль</p>`, [
    { label: 'Отмена' },
    {
      label: 'Войти',
      primary: true,
      onClick: () => {
        const ok = $('#m-login').value === CONFIG.admin.login && $('#m-pass').value === CONFIG.admin.password;
        if (!ok) { $('#m-error').hidden = false; return false; }
        setAdmin(true);
      },
    },
  ]);
  $('#m-login').focus();
}

// Загрузка файла данных: проверяем, показываем что внутри и только после подтверждения заменяем.
$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let incoming;
  try { incoming = await DB.readFile(file); }
  catch (err) {
    openModal('Не удалось загрузить файл', `<p>${escapeHtml(err.message)}</p>`, [{ label: 'Закрыть', primary: true }]);
    return;
  }
  const upd = incoming.updatedAt ? new Date(incoming.updatedAt) : null;
  openModal('Заменить данные?', `
    <p>Все текущие данные на этом устройстве будут заменены содержимым файла <b>${escapeHtml(file.name)}</b>.</p>
    <p class="muted">
      В файле: оборудования — ${incoming.equipment.length}, смен в истории — ${incoming.shifts.length}.<br>
      Файл изменён: ${upd ? `${fmtDate(upd)} ${fmtTime(upd)}` : 'неизвестно'}.
    </p>
    <p class="muted">Совет: сначала скачайте текущий файл как резервную копию.</p>`, [
    { label: 'Отмена' },
    { label: 'Заменить', primary: true, onClick: () => DB.replace(incoming) },
  ]);
});

// Режим настроек помним в sessionStorage: обновление страницы его не сбрасывает,
// а закрытие приложения или вкладки — сбрасывает, и пароль придётся ввести снова.
const adminSession = {
  get() { try { return sessionStorage.getItem('jp.admin') === '1'; } catch { return false; } },
  set(on) { try { on ? sessionStorage.setItem('jp.admin', '1') : sessionStorage.removeItem('jp.admin'); } catch {} },
};

function setAdmin(on) {
  state.admin = on;
  adminSession.set(on);
  state.editing = false;
  document.body.classList.toggle('is-admin', on);
  // Вышли из режима настроек, стоя на его вкладке, — возвращаемся к текущей смене.
  if (!on && CONFIG.adminTabs.some((t) => t.id === state.tab)) {
    state.tab = 'current';
    store.set('tab', state.tab);
  }
  if (DB.data.currentShift) { renderNav(); renderTab(); }
}

// ================= Ошибки у полей =================
// Подсвечивает поле (или карточку), пишет под ним текст ошибки, прокручивает к нему и ставит фокус.
// Нижняя строка ошибки формы (lineSel, aria-live) — дубль для экранного диктора.
// field — селектор или элемент; если он внутри .field, подсвечивается всё поле с подписью.
function fieldError(field, msg, lineSel) {
  clearFieldErrors();
  const el = typeof field === 'string' ? $(field) : field;
  const box = el?.closest('.field') || el;
  if (box) {
    box.classList.add('is-invalid');
    box.insertAdjacentHTML('beforeend', `<span class="field__error">${escapeHtml(msg)}</span>`);
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const target = el.matches('input, select, textarea') ? el : el.querySelector('input:not([type="hidden"]), select, textarea, button');
    target?.focus({ preventScroll: true });
  }
  const line = $(lineSel);
  if (line) { line.textContent = msg; line.hidden = false; }
  return false;
}

function clearFieldErrors(scope = document) {
  scope.querySelectorAll('.is-invalid').forEach((x) => x.classList.remove('is-invalid'));
  scope.querySelectorAll('.field__error').forEach((x) => x.remove());
}

// Поле поправили — подсветка с него снимается.
['input', 'change', 'click'].forEach((type) => $('#modal').addEventListener(type, (e) => {
  const box = e.target.closest?.('.is-invalid');
  if (!box || (type === 'click' && !e.target.closest('button'))) return;
  box.classList.remove('is-invalid');
  box.querySelector(':scope > .field__error')?.remove();
}));

// ================= Модальное окно =================
let modalReturnFocus = null; // куда вернуть фокус после закрытия окна
let modalDirty = false;      // в окне что-то ввели — тап по фону и Escape его не закрывают

// fill — кнопки внизу на всю ширину, одинакового размера.
function openModal(title, bodyHtml, actions, { wide = false, fill = false } = {}) {
  $('#modal .modal__card').classList.toggle('modal__card--wide', wide);
  $('#modal-actions').classList.toggle('modal__actions--fill', fill);
  $('#modal-body').scrollTop = 0;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  modalDirty = false;
  const wrap = $('#modal-actions');
  wrap.innerHTML = '';
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.primary ? 'btn--primary' : a.danger ? 'btn--danger' : 'btn--ghost');
    b.textContent = a.label;
    b.addEventListener('click', () => {
      if (a.onClick && a.onClick() === false) return; // false — не закрывать
      closeModal();
    });
    wrap.appendChild(b);
  });
  // Фокус — в окно (вызывающий код может сразу перевести его на нужное поле),
  // после закрытия возвращаем туда, где он был.
  if ($('#modal').hidden) modalReturnFocus = document.activeElement;
  $('#modal').hidden = false;
  $('#modal .modal__card').focus();
}

function closeModal() {
  if ($('#modal').hidden) return;
  $('#modal').hidden = true;
  if ($('#modal').contains(document.activeElement)) document.activeElement.blur();
  modalReturnFocus?.focus?.();
  modalReturnFocus = null;
}

// Ввели что-то в форме (поле, чип, переключатель, строка запчасти) — окно больше не закрывается
// случайным тапом по фону или Escape: потерять данные можно только кнопкой «Отмена».
['input', 'change'].forEach((type) => $('#modal-body').addEventListener(type, () => { modalDirty = true; }));
$('#modal-body').addEventListener('click', (e) => {
  if (e.target.closest('#theme-switch')) return; // настройка устройства, а не ввод данных
  if (e.target.closest('.chip, .segmented__btn, [data-used-add], [data-used-del], [data-choice]')) modalDirty = true;
});

// Закрытие «мимо» окна: при несохранённом вводе — только короткое встряхивание карточки.
function dismissModal() {
  if (!modalDirty) return closeModal();
  const card = $('#modal .modal__card');
  card.classList.remove('is-shaking');
  void card.offsetWidth; // перезапуск анимации
  card.classList.add('is-shaking');
}

$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') dismissModal(); });
document.addEventListener('keydown', (e) => {
  if ($('#modal').hidden) return;
  if (e.key === 'Escape') dismissModal();
  if (e.key === 'Enter' && !['TEXTAREA', 'BUTTON'].includes(e.target.tagName)) $('#modal-actions .btn--primary')?.click();
  // Tab ходит по кругу внутри окна и не уводит фокус на страницу за ним.
  if (e.key === 'Tab') {
    const card = $('#modal .modal__card');
    const items = [...card.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!items.length) return e.preventDefault();
    const first = items[0], last = items[items.length - 1];
    const outside = !card.contains(document.activeElement) || document.activeElement === card;
    if (e.shiftKey && (outside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (outside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================= Запуск =================
$('#btn-settings .tab__icon').innerHTML = ICONS.settings;
$('#btn-edit .edit-btn__icon').innerHTML = ICONS.edit;
tickClock();
setInterval(tickClock, 1000); // заодно раз в минуту обновляет таймеры простоя (refreshTimers)

// ================= Режим зрителя =================
// Только просмотр: без начала/закрытия смены, добавления, правки и входа в настройки.
// Это ограничение интерфейса, а не защита данных.
function setViewer(on) {
  state.viewer = on;
  store.set('viewer', on);
  setAdmin(false);
  closeModal();
  document.body.classList.toggle('is-viewer', on);
  renderApp();
}

$('#btn-viewer').addEventListener('click', () => setViewer(true));

// «Устройство в смене»: на нём заступили на смену или нажали «Продолжить смену».
// Без этого устройство с общими данными сразу попадало бы в чужую смену, минуя выбор режима.
function setJoined(on) {
  state.joined = on;
  store.set('joined', on);
}

// Экран всегда следует за данными: смена началась/закончилась (в том числе на другом устройстве) —
// переключаемся; поменялись данные — перерисовываем. Зритель остаётся в основном окне и без смены.
function renderApp() {
  applyTheme();
  const shift = DB.data.currentShift;
  if (!shift && state.joined) setJoined(false);
  // Смену забрали или начали на другом устройстве — отсюда её больше не ведут.
  if (shift && state.joined && !canControl(shift)) {
    setJoined(false);
    showBusyError(shift, 'Смена передана другому устройству');
  }
  if (state.viewer || (shift && state.joined)) showMainScreen();
  else if (!$('#screen-main').hidden) showStartScreen();
  else if (!$('#start-step-1').hidden) { renderStartRunning(); refreshStartScreen(); }
}
DB.onChange(renderApp);

// Переход со старой версии: на этом устройстве уже шла смена — считаем, что оно в ней.
state.joined = store.get('joined', undefined);
if (state.joined === undefined) setJoined(!!DB.data.currentShift && canControl(DB.data.currentShift));
// После обновления страницы возвращаем режим настроек, но только устройству, которое ведёт смену.
if (adminSession.get() && !state.viewer && DB.data.currentShift && state.joined) {
  state.admin = true;
  document.body.classList.add('is-admin');
} else {
  adminSession.set(false);
}
if (!visibleTabs().some((t) => t.id === state.tab)) state.tab = 'current';
renderApp();
if ($('#screen-main').hidden) showStartScreen();

// ================= OneDrive =================
OneDrive.onChange(renderSaveStatus);
OneDrive.init();

// ================= Офлайн-режим =================
// Service worker кэширует файлы приложения. С file:// не регистрируется (так браузер не умеет).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
