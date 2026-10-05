// ================= Хранилище =================
// Пока всё хранится локально в браузере (localStorage).
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
  shift: store.get('shift', null), // { master, type, start }
  tab: store.get('tab', 'current'),
  admin: false,                     // режим настроек, не сохраняется
};

const $ = (sel) => document.querySelector(sel);
const OTHER = '__other__';

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
  const { start } = CONFIG.shiftTypes[type];
  return [-1, 0, 1]
    .map((off) => atTime(now, start, off))
    .reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
}

function plannedEnd(type, startDate) {
  const end = atTime(startDate, CONFIG.shiftTypes[type].end);
  if (end <= startDate) end.setDate(end.getDate() + 1);
  return end;
}

// Какая смена идёт сейчас по расписанию.
function currentShiftType(now = new Date()) {
  for (const type of Object.keys(CONFIG.shiftTypes)) {
    const s = plannedStart(type, now);
    if (s <= now && now < plannedEnd(type, s)) return type;
  }
  return Object.keys(CONFIG.shiftTypes)[0];
}

// ================= Экран начала смены =================
let formType = currentShiftType();

function showStartScreen() {
  $('#screen-main').hidden = true;
  $('#screen-start').hidden = false;
  $('#start-step-1').hidden = false;
  $('#start-step-2').hidden = true;
}

function openShiftForm() {
  const sel = $('#f-master');
  sel.innerHTML =
    '<option value="" disabled selected>Выберите из списка</option>' +
    CONFIG.masters.map((m) => `<option>${m}</option>`).join('') +
    `<option value="${OTHER}">Другое…</option>`;
  $('#f-master-other').value = '';
  $('#f-master-other-wrap').hidden = true;

  formType = currentShiftType();
  renderTypeSwitch();

  $('#start-step-1').hidden = true;
  $('#start-step-2').hidden = false;
}

function renderTypeSwitch() {
  $('#f-type').innerHTML = Object.entries(CONFIG.shiftTypes)
    .map(([id, t]) =>
      `<button type="button" class="segmented__btn${id === formType ? ' is-active' : ''}" data-type="${id}">${t.label}</button>`)
    .join('');
  const s = plannedStart(formType);
  $('#f-start').textContent = `${fmtDate(s)}, ${fmtTime(s)}`;
}

$('#btn-take-shift').addEventListener('click', openShiftForm);
$('#btn-back').addEventListener('click', showStartScreen);

$('#f-master').addEventListener('change', (e) => {
  const other = e.target.value === OTHER;
  $('#f-master-other-wrap').hidden = !other;
  $('#f-master-other').required = other;
  if (other) $('#f-master-other').focus();
});

$('#f-type').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  formType = btn.dataset.type;
  renderTypeSwitch();
});

$('#start-step-2').addEventListener('submit', (e) => {
  e.preventDefault();
  const sel = $('#f-master').value;
  const master = sel === OTHER ? $('#f-master-other').value.trim() : sel;
  if (!master) return;
  state.shift = { master, type: formType, start: plannedStart(formType).toISOString() };
  store.set('shift', state.shift);
  showMainScreen();
});

// ================= Основное окно =================
function showMainScreen() {
  $('#screen-start').hidden = true;
  $('#screen-main').hidden = false;
  renderShiftInfo();
  renderNav();
  renderTab();
}

function tickClock() {
  const d = new Date();
  $('#clock-time').textContent = fmtTime(d);
  $('#clock-date').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  $('#clock-weekday').textContent = WEEKDAYS[d.getDay()];
}

function renderShiftInfo() {
  if (!state.shift) return;
  const { master, type } = state.shift;
  const start = new Date(state.shift.start);
  const end = plannedEnd(type, start);
  $('#shift-info').innerHTML = `
    <div class="info__type">${CONFIG.shiftTypes[type].label} смена</div>
    <div class="info__row">Мастер: <b>${escapeHtml(master)}</b></div>
    <div class="info__row">${fmtDate(start)} ${fmtTime(start)} — ${fmtDate(end)} ${fmtTime(end)}</div>`;
}

function renderNav() {
  const badges = getBadges();
  $('#nav-tabs').innerHTML = CONFIG.tabs
    .map((t) => `
      <button class="tab${t.id === state.tab ? ' is-active' : ''}" data-tab="${t.id}" title="${t.label}">
        <span class="tab__icon">${ICONS[t.icon]}</span>
        <span class="tab__label">${t.label}</span>
        ${badges[t.id] ? `<span class="badge badge--${badges[t.id]}">!</span>` : ''}
      </button>`)
    .join('');
}

// Уведомления на вкладках: red — есть заявки на ремонт, yellow — запчасти ниже минимума.
function getBadges() {
  const repairs = store.get('repairs', []);
  const parts = store.get('parts', []);
  return {
    repair: repairs.length ? 'red' : null,
    warehouse: parts.some((p) => p.qty < p.min) ? 'yellow' : null,
  };
}

$('#nav-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  state.tab = btn.dataset.tab;
  store.set('tab', state.tab);
  renderNav();
  renderTab();
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
  current: 'Добавить поломку',
  repair: 'Добавить на ремонт',
  warehouse: 'Добавить запчасти',
  manuals: 'Поиск решения по ошибке',
};

function renderTab() {
  const tab = CONFIG.tabs.find((t) => t.id === state.tab) || CONFIG.tabs[0];
  $('#panel').innerHTML = `
    <h2 class="panel__title">${tab.label}</h2>
    ${state.admin ? '<div class="panel__admin">Режим редактирования</div>' : ''}
    <div class="empty">
      <div class="empty__icon">${ICONS[tab.icon]}</div>
      <p>${TAB_STUBS[tab.id]}</p>
      <p class="muted">Раздел в разработке</p>
    </div>`;

  const fab = $('#fab');
  fab.hidden = !tab.fab;
  if (tab.fab) {
    fab.innerHTML = ICONS[tab.fab];
    fab.title = FAB_TITLES[tab.id];
  }
}

$('#fab').addEventListener('click', () => {
  openModal(FAB_TITLES[state.tab], '<p class="muted">Форма будет добавлена позже.</p>', [
    { label: 'Закрыть' },
  ]);
});

// ================= Завершение смены =================
$('#btn-end-shift').addEventListener('click', () => {
  openModal('Закончить смену?', '<p>Текущая смена будет закрыта.</p>', [
    { label: 'Отмена' },
    {
      label: 'Закончить',
      primary: true,
      onClick: () => {
        // TODO: перенос смены в историю
        state.shift = null;
        store.remove('shift');
        setAdmin(false);
        showStartScreen();
      },
    },
  ]);
});

// ================= Настройки =================
$('#btn-settings').addEventListener('click', () => {
  if (state.admin) {
    openModal('Настройки', `
      <ul class="settings-list">
        <li>Оборудование и подгруппы</li>
        <li>Группы и виды запчастей</li>
        <li>Данные смен</li>
      </ul>
      <p class="muted">Разделы настроек будут добавлены позже.</p>`, [
      { label: 'Выйти из настроек', onClick: () => setAdmin(false) },
      { label: 'Закрыть', primary: true },
    ]);
    return;
  }

  openModal('Вход в настройки', `
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
});

function setAdmin(on) {
  state.admin = on;
  document.body.classList.toggle('is-admin', on);
  if (state.shift) renderTab();
}

// ================= Модальное окно =================
function openModal(title, bodyHtml, actions) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  const wrap = $('#modal-actions');
  wrap.innerHTML = '';
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.primary ? 'btn--primary' : 'btn--ghost');
    b.textContent = a.label;
    b.addEventListener('click', () => {
      if (a.onClick && a.onClick() === false) return; // false — не закрывать
      closeModal();
    });
    wrap.appendChild(b);
  });
  $('#modal').hidden = false;
}

function closeModal() { $('#modal').hidden = true; }

$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => {
  if ($('#modal').hidden) return;
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter') $('#modal-actions .btn--primary')?.click();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================= Запуск =================
$('#btn-settings .tab__icon').innerHTML = ICONS.settings;
tickClock();
setInterval(tickClock, 1000);
if (state.shift) showMainScreen(); else showStartScreen();
