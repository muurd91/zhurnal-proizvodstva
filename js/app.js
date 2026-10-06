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
  admin: false,                     // режим настроек, не сохраняется
  editing: false,                   // редактирование текущей вкладки (только в режиме настроек)
  viewer: store.get('viewer', false), // режим зрителя: только просмотр, запоминается на устройстве
};

const $ = (sel) => document.querySelector(sel);
const OTHER = '__other__';

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
  const shift = DB.data.currentShift;
  $('#btn-take-shift').textContent = shift ? 'Продолжить смену' : 'Заступить на смену';
  $('#start-running').hidden = !shift;
  if (shift) $('#start-running').innerHTML = `Идёт ${shiftTitle(shift).toLowerCase()} · мастер <b>${escapeHtml(shift.master)}</b>`;
}

function openShiftForm() {
  const sel = $('#f-master');
  sel.innerHTML =
    '<option value="" disabled selected>Выберите из списка</option>' +
    SETTINGS().masters.map((m) => `<option>${escapeHtml(m)}</option>`).join('') +
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

$('#btn-take-shift').addEventListener('click', () => {
  if (!DB.data.currentShift) return openShiftForm();
  setJoined(true);
  renderApp();
});
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
  const number = $('#f-number').value || '';
  if (SETTINGS().shiftNumbers.length && !number) return;
  const start = plannedStart(formType);
  setJoined(true);
  DB.update((d) => {
    // Плановый конец фиксируем при старте: правка расписания не должна сдвигать уже идущую смену.
    d.currentShift = {
      id: uid(), master, number, type: formType,
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
  $('#btn-end-shift').innerHTML = state.viewer ? 'Выйти из<br>просмотра' : 'Закончить<br>смену';
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
  const shift = DB.data.currentShift;
  const viewerTag = state.viewer ? '<span class="viewer-tag">Режим зрителя</span>' : '';
  if (!shift) {
    $('#shift-info').innerHTML = `${viewerTag}<div class="info__type">Смена не начата</div>`;
    return;
  }
  const { master, type } = shift;
  const start = new Date(shift.start);
  const end = shift.plannedEnd ? new Date(shift.plannedEnd) : plannedEnd(type, start);
  $('#shift-info').innerHTML = `
    ${viewerTag}
    <div class="info__type">${shiftTitle(shift)}</div>
    <div class="info__row">Мастер: <b>${escapeHtml(master)}</b></div>
    <div class="info__row">${fmtDate(start)} ${fmtTime(start)} — ${fmtDate(end)} ${fmtTime(end)}</div>`;
}

// «Дневная смена № 2»
const shiftTitle = (sh) =>
  `${SETTINGS().shiftTypes[sh.type]?.label || ''} смена${sh.number ? ` № ${escapeHtml(sh.number)}` : ''}`;

// Обычные вкладки + вкладки режима настроек.
const visibleTabs = () => (state.admin ? [...CONFIG.tabs, ...CONFIG.adminTabs] : CONFIG.tabs);

function renderNav() {
  const badges = getBadges();
  $('#nav-tabs').innerHTML = visibleTabs()
    .map((t) => `
      <button class="tab${t.id === state.tab ? ' is-active' : ''}${CONFIG.adminTabs.includes(t) ? ' tab--admin' : ''}" data-tab="${t.id}" title="${t.label}">
        <span class="tab__icon">${ICONS[t.icon]}</span>
        <span class="tab__label">${t.label}</span>
        ${badges[t.id] ? `<span class="badge badge--${badges[t.id]}">!</span>` : ''}
      </button>`)
    .join('');
}

// Уведомления на вкладках: red — есть заявки на ремонт, yellow — запчасти ниже минимума.
function getBadges() {
  const { repairs, parts } = DB.data;
  return {
    repair: repairs.some((r) => r.status !== 'done') ? 'red' : null,
    warehouse: parts.some((p) => p.qty < p.min) ? 'yellow' : null,
  };
}

$('#nav-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  state.tab = btn.dataset.tab;
  state.editing = false;
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

// Что можно менять во вкладке в режиме настроек.
const EDIT_HINTS = {
  current:   'Редактирование и удаление поломок.',
  history:   'Редактирование и удаление поломок.',
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
  $('#panel').innerHTML = `
    <h2 class="panel__title">${tab.label}</h2>
    ${editing ? `<div class="panel__admin">Редактирование: ${EDIT_HINTS[tab.id]}</div>` : ''}
    ${body}`;

  const fab = $('#fab');
  fab.hidden = !tab.fab;
  if (tab.fab) {
    fab.innerHTML = ICONS[tab.fab];
    fab.title = FAB_TITLES[tab.id];
  }

  const edit = $('#btn-edit');
  edit.hidden = !state.admin || tab.id === 'shifts';
  edit.classList.toggle('is-active', editing);
  edit.querySelector('.edit-btn__label').textContent = editing ? 'Готово' : 'Редактировать';
}

$('#btn-edit').addEventListener('click', () => {
  // В перечне оборудования кнопка сразу открывает окно внесения данных.
  if (state.tab === 'equipment') return openEquipmentForm();
  state.editing = !state.editing;
  renderTab();
});

// ================= Перечень оборудования =================
// Запись: { id, group, name, mark, inv }
const getEquipment = () => DB.data.equipment;
const getGroups = () => [...new Set(getEquipment().map((e) => e.group))].sort((a, b) => a.localeCompare(b, 'ru'));

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
    return (sb.inRepair ? 1 : 0) - (sa.inRepair ? 1 : 0) || sb.downtime - sa.downtime || a.name.localeCompare(b.name, 'ru');
  };

  const head = `
    <div class="eq-head">
      <span>Оборудование</span><span>Состояние</span><span>Поломок</span><span>Простой</span><span>Последняя</span><span></span>
    </div>`;

  return periodSwitch() + tiles + head + getGroups().map((g) => `
    <section class="eq-group">
      <h3 class="eq-group__title">${escapeHtml(g)}</h3>
      <div class="eq-rows">
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
  repair: repairView, shifts: shiftsSettingsView,
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

  const shown = shifts.slice(0, state.historyLimit);
  let lastDay = '';
  const html = shown.map((sh) => {
    const start = new Date(sh.start);
    const day = `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}, ${WEEKDAYS[start.getDay()]}`;
    const dayHead = day !== lastDay ? `<h3 class="eq-group__title hist-day">${day}</h3>` : '';
    lastDay = day;
    return dayHead + shiftCard(sh);
  }).join('');

  const more = shifts.length > shown.length
    ? `<button class="btn hist-more" data-more>Показать ещё (${shifts.length - shown.length})</button>`
    : '';
  return html + more;
}

function shiftCard(sh) {
  const start = new Date(sh.start);
  const end = sh.current ? new Date() : new Date(sh.end);
  const { own, carried, downtime } = shiftBreakdowns(sh, end);
  const rows = (list, withDate) => list.map((b) => withTrash(breakdownRow(b, withDate), b)).join('');

  return `
    <section class="hist-shift${sh.current ? ' hist-shift--current' : ''}">
      <header class="hist-shift__head">
        <div>
          <div class="hist-shift__title">${shiftTitle(sh)}${sh.current ? ' <span class="hist-now">идёт сейчас</span>' : ''}</div>
          <div class="hist-shift__sub">
            ${fmtTime(start)} — ${sh.current ? '…' : `${fmtDate(end) !== fmtDate(start) ? `${fmtDate(end)} ` : ''}${fmtTime(end)}`}
            · Мастер: <b>${escapeHtml(sh.master)}</b>
          </div>
        </div>
        <div class="hist-shift__nums">
          <span><b>${own.length}</b> ${plural(own.length, 'поломка', 'поломки', 'поломок')}</span>
          <span><b>${fmtDuration(downtime)}</b> простоя</span>
        </div>
      </header>
      ${own.length || carried.length ? '' : '<p class="muted hist-empty">Поломок не было.</p>'}
      ${own.length ? `<div class="hist-rows">${rows(own)}</div>` : ''}
      ${carried.length ? `
        <div class="hist-carried">Переходящие с прошлых смен · ${carried.length}</div>
        <div class="hist-rows">${rows(carried, true)}</div>` : ''}
    </section>`;
}

// Компактная строка поломки; нажатие открывает полную информацию.
function breakdownRow(b, withDate = false) {
  const eq = DB.data.equipment.find((e) => e.id === b.equipmentId);
  const done = b.status === 'done';
  const dur = fmtDuration((done ? new Date(b.end) : new Date()) - new Date(b.start));
  return `
    <button class="hist-row hist-row--${b.status}" data-bd="${b.id}">
      <span class="hist-row__time">${withDate ? `<small>${fmtDate(new Date(b.start)).slice(0, 5)}</small>` : ''}${fmtTime(new Date(b.start))}</span>
      <span class="hist-row__main">
        <span class="bd-item__name">${escapeHtml(equipmentName(b.equipmentId))}${eq?.mark ? ` <span class="bd-item__mark">${escapeHtml(eq.mark)}</span>` : ''}</span>
        <span class="hist-row__reason">${escapeHtml(b.reason)}</span>
      </span>
      <span class="hist-row__info"><span class="hist-row__type">${escapeHtml(b.type)}</span><span class="hist-row__dur">${dur}</span></span>
      <span class="bd-status bd-status--${b.status}">${done ? 'Отремонтировано' : 'В ремонте'}</span>
    </button>`;
}

// ================= Данные смен (только режим настроек) =================
// Изменения сохраняются сразу. Уже записанные смены и поломки не меняются:
// в них остаются те фамилии и время, что были на момент записи.

const LIST_SETTINGS = {
  masters:      { title: 'Мастера', placeholder: 'Фамилия мастера', item: 'мастер' },
  shiftNumbers: { title: 'Номера смен', placeholder: 'Например: 5', item: 'номер' },
};

function shiftsSettingsView() {
  const s = SETTINGS();
  const listBlock = (key) => {
    const cfg = LIST_SETTINGS[key];
    return `
      <section class="set-block">
        <h3 class="eq-group__title">${cfg.title} · ${s[key].length}</h3>
        <div class="set-list">
          ${s[key].map((v, i) => `
            <div class="set-item">
              <input value="${escapeHtml(v)}" data-list="${key}" data-idx="${i}" aria-label="${cfg.title}">
              <button class="trash trash--sm" data-list-del="${key}" data-idx="${i}" title="Удалить" aria-label="Удалить">${ICONS.trash}</button>
            </div>`).join('') || `<p class="muted">Список пуст.</p>`}
        </div>
        <div class="set-add">
          <input placeholder="${cfg.placeholder}" data-list-new="${key}" autocomplete="off">
          <button class="btn btn--primary" data-list-add="${key}">Добавить</button>
        </div>
      </section>`;
  };

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
      ${listBlock('masters')}
      ${listBlock('shiftNumbers')}
    </div>
    <section class="set-block">
      <h3 class="eq-group__title">Время смен</h3>
      <div class="set-times">${times}</div>
      <p class="error" id="set-time-error" hidden></p>
    </section>`;
}

function addListItem(key) {
  const input = document.querySelector(`[data-list-new="${key}"]`);
  const v = input.value.trim();
  if (!v) return input.focus();
  if (SETTINGS()[key].includes(v)) {
    input.setCustomValidity('Уже есть в списке');
    input.reportValidity();
    setTimeout(() => input.setCustomValidity(''), 1500);
    return;
  }
  DB.update((d) => { d.settings[key].push(v); });
  document.querySelector(`[data-list-new="${key}"]`)?.focus();
}

$('#panel').addEventListener('click', (e) => {
  const add = e.target.closest('[data-list-add]');
  if (add) return addListItem(add.dataset.listAdd);
  const del = e.target.closest('[data-list-del]');
  if (del) DB.update((d) => { d.settings[del.dataset.listDel].splice(Number(del.dataset.idx), 1); });
});

$('#panel').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.listNew) addListItem(e.target.dataset.listNew);
});

$('#panel').addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.list) {
    const v = el.value.trim();
    const list = SETTINGS()[el.dataset.list];
    const idx = Number(el.dataset.idx);
    if (!v || list.some((x, i) => x === v && i !== idx)) { el.value = list[idx]; return; } // пусто или дубль — откат
    DB.update((d) => { d.settings[el.dataset.list][idx] = v; });
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

  const del = e.target.closest('[data-del]');
  if (del) {
    if (del.dataset.kind === 'repair') return confirmDeleteRepair(DB.data.repairs.find((x) => x.id === del.dataset.del));
    return confirmDeleteBreakdown(DB.data.breakdowns.find((x) => x.id === del.dataset.del));
  }

  const rq = e.target.closest('[data-rq]');
  if (rq) return openRepair(DB.data.repairs.find((x) => x.id === rq.dataset.rq));

  const bd = e.target.closest('[data-bd]');
  if (bd) return openBreakdownForm(DB.data.breakdowns.find((x) => x.id === bd.dataset.bd));

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
  const title = kind === 'repair' ? 'Удалить заявку' : 'Удалить поломку';
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
    <p class="error" id="eq-error" hidden></p>`, [
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
  const data = { group, name: val('#eq-name'), mark: val('#eq-mark'), inv: val('#eq-inv') };

  const list = getEquipment();
  const error = (msg) => { $('#eq-error').textContent = msg; $('#eq-error').hidden = false; return false; };
  if (!data.group) return error('Укажите подгруппу.');
  if (!data.name) return error('Укажите наименование оборудования.');
  if (data.inv && list.some((x) => x.inv === data.inv && (!eq || x.id !== eq.id))) {
    return error(`Инвентарный номер ${data.inv} уже есть в перечне.`);
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
        <span>Простой: <b>${dur}</b></span>
        <span>Мастер: <b>${escapeHtml(b.master)}</b></span>
        ${b.handovers?.length ? `<span>Передано сменам: <b>${b.handovers.length}</b></span>` : ''}
        ${done ? `<span>Отремонтировал: <b>${escapeHtml(b.repairedBy)}</b></span>` : ''}
      </span>
    </${tag}>`;
}

// Текущая смена: всё, что ещё в ремонте (в том числе с прошлых смен), и поломки этой смены.
function currentShiftView() {
  const shiftId = DB.data.currentShift?.id;
  const all = DB.data.breakdowns;
  const inRepair = all.filter((b) => b.status === 'repair').sort((a, b) => a.start.localeCompare(b.start));
  const doneHere = all.filter((b) => b.status === 'done' && b.shiftId === shiftId).sort((a, b) => b.start.localeCompare(a.start));

  if (!inRepair.length && !doneHere.length) {
    return `
      <div class="empty">
        <div class="empty__icon">${ICONS.current}</div>
        <p>Поломок нет — всё оборудование работает.</p>
        <p class="muted">Чтобы отметить поломку, нажмите + внизу справа.</p>
      </div>`;
  }
  const section = (title, list) => list.length
    ? `<section class="bd-section"><h3 class="eq-group__title">${title} · ${list.length}</h3><div class="bd-list">${list.map((b) => withTrash(breakdownCard(b), b)).join('')}</div></section>`
    : '';
  return section('В ремонте', inRepair) + section('Отремонтировано в эту смену', doneHere);
}

// Фамилии, которые уже вводили в «Кто закончил ремонт», — для подсказок.
const knownRepairers = () =>
  [...new Set(DB.data.breakdowns.map((b) => b.repairedBy).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));

function openBreakdownForm(bd = null) {
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
  const curEq = bd && eqList.find((e) => e.id === bd.equipmentId);
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
    </div>
    <div class="field">
      <span class="field__label">Остановка у мастера</span>
      <div class="field__auto">${escapeHtml(master) || '—'}</div>
    </div>
    <p class="error" id="bd-error" hidden></p>`, actions, { fill: true });

  const fillEquipment = () => {
    const g = $('#bd-group').value;
    const sel = $('#bd-eq');
    const items = eqList.filter((e) => e.group === g).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
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
  const error = (msg) => { $('#bd-error').textContent = msg; $('#bd-error').hidden = false; return false; };
  const equipmentId = $('#bd-eq').value;
  const startVal = $('#bd-start').value;
  const reason = $('#bd-reason').value.trim();

  if (!equipmentId) return error('Выберите оборудование.');
  if (!startVal) return error('Укажите время начала остановки.');
  if (!reason) return error('Опишите причину остановки.');
  if (!type) return error('Выберите тип поломки.');

  const start = new Date(startVal);
  let end = null;
  let repairedBy = '';
  if (status === 'done') {
    const endVal = $('#bd-end').value;
    repairedBy = $('#bd-by').value.trim();
    if (!endVal) return error('Укажите время окончания ремонта.');
    end = new Date(endVal);
    if (end < start) return error('Окончание ремонта не может быть раньше начала остановки.');
    if (!repairedBy) return error('Укажите, кто закончил ремонт.');
  }

  const fields = {
    equipmentId, reason, type, status,
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    repairedBy,
  };

  DB.update((d) => {
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
    <p>Запись о поломке <b>${escapeHtml(equipmentName(bd.equipmentId))}</b> от ${fmtDateTime(bd.start)} будет удалена без возможности восстановления.</p>`, [
    { label: 'Отмена' },
    { label: 'Удалить', danger: true, onClick: () => DB.update((d) => { d.breakdowns = d.breakdowns.filter((x) => x.id !== bd.id); }) },
  ]);
}

// ================= Необходимый ремонт =================
// Заявка: { id, equipmentId, type, description, author, createdAt, shiftId,
//           status: 'open' | 'done', doneAt, doneBy }

// Подсказки фамилий: мастера + все, кто уже фигурировал в записях.
const knownPeople = () => [...new Set([
  ...SETTINGS().masters,
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
        <span class="bd-status bd-status--${done ? 'done' : 'repair'}">${done ? 'Выполнено' : 'Ожидает'}</span>
      </span>
      <span class="bd-item__reason">${escapeHtml(r.description)}</span>
      <span class="bd-item__meta">
        <span>${escapeHtml(r.type)}</span>
        <span>Создана: <b>${fmtDateTime(r.createdAt)}</b></span>
        <span>Составил: <b>${escapeHtml(r.author)}</b></span>
        <span>${done ? 'Выполнена за' : 'Ожидает'}: <b>${waiting}</b></span>
        ${done ? `<span>Выполнил: <b>${escapeHtml(r.doneBy)}</b> ${fmtDateTime(r.doneAt)}</span>` : ''}
      </span>
    </${tag}>`;
}

function repairView() {
  const all = DB.data.repairs;
  const open = all.filter((r) => r.status !== 'done').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = all.filter((r) => r.status === 'done').sort((a, b) => b.doneAt.localeCompare(a.doneAt)).slice(0, 20);
  if (!all.length) {
    return `
      <div class="empty">
        <div class="empty__icon">${ICONS.repair}</div>
        <p>Заявок на ремонт нет.</p>
        <p class="muted">Чтобы добавить заявку, нажмите + внизу справа.</p>
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
    <p class="error" id="rq-error" hidden></p>`, [
    { label: 'Закрыть' },
    {
      label: 'Выполнено',
      primary: true,
      onClick: () => {
        const by = $('#rq-done-by').value.trim();
        if (!by) { $('#rq-error').textContent = 'Укажите, кто выполнил ремонт.'; $('#rq-error').hidden = false; return false; }
        DB.update((d) => {
          Object.assign(d.repairs.find((x) => x.id === r.id), { status: 'done', doneBy: by, doneAt: new Date().toISOString() });
        });
      },
    },
  ], { fill: true });
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
    <p class="error" id="rq-error" hidden></p>`, [
    { label: 'Отмена' },
    { label: 'Сохранить', primary: true, onClick: () => saveRepair(r, type) },
  ], { fill: true });

  const fillEquipment = () => {
    const g = $('#rq-group').value;
    const items = eqList.filter((e) => e.group === g).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
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

function saveRepair(r, type) {
  const error = (msg) => { $('#rq-error').textContent = msg; $('#rq-error').hidden = false; return false; };
  const equipmentId = $('#rq-eq').value;
  const description = $('#rq-desc').value.trim();
  const author = $('#rq-author').value.trim();
  if (!equipmentId) return error('Выберите оборудование.');
  if (!type) return error('Выберите тип работ.');
  if (!description) return error('Опишите, что нужно сделать.');
  if (!author) return error('Укажите, кто составил заявку.');

  DB.update((d) => {
    const found = r && d.repairs.find((x) => x.id === r.id);
    if (found) Object.assign(found, { equipmentId, type, description, author });
    else d.repairs.push({
      id: uid(), equipmentId, type, description, author,
      createdAt: new Date().toISOString(),
      shiftId: d.currentShift?.id || null,
      status: 'open', doneAt: null, doneBy: '',
    });
  });
}

function confirmDeleteRepair(r) {
  openModal('Удалить заявку?', `
    <p>Заявка на ремонт <b>${escapeHtml(equipmentName(r.equipmentId))}</b> от ${fmtDateTime(r.createdAt)} будет удалена без возможности восстановления.</p>`, [
    { label: 'Отмена' },
    { label: 'Удалить', danger: true, onClick: () => DB.update((d) => { d.repairs = d.repairs.filter((x) => x.id !== r.id); }) },
  ]);
}

$('#fab').addEventListener('click', () => {
  if (state.viewer) return;
  if (state.tab === 'current') return openBreakdownForm();
  if (state.tab === 'repair') return openRepairForm();
  openModal(FAB_TITLES[state.tab], '<p class="muted">Форма будет добавлена позже.</p>', [
    { label: 'Закрыть' },
  ]);
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
        if (c) Object.assign(b, { status: 'done', end: c.end, repairedBy: c.repairedBy });
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
          </div>
        </div>`;
      }).join('')}
    </div>
    <datalist id="ho-by-list">${knownRepairers().map((n) => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
    <p class="error" id="ho-error" hidden></p>`, [
    { label: 'Отмена' },
    {
      label: 'Закончить смену',
      primary: true,
      onClick: () => {
        const error = (msg, row) => {
          $('#ho-error').textContent = msg;
          $('#ho-error').hidden = false;
          row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return false;
        };
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
          closes[b.id] = { end: end.toISOString(), repairedBy: by };
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

// ================= Настройки =================
$('#btn-settings').addEventListener('click', () => {
  if (state.viewer) return;
  if (state.admin) {
    const d = DB.data;
    const updated = d.updatedAt ? new Date(d.updatedAt) : null;
    openModal('Настройки', `
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

function setAdmin(on) {
  state.admin = on;
  state.editing = false;
  document.body.classList.toggle('is-admin', on);
  // Вышли из режима настроек, стоя на его вкладке, — возвращаемся к текущей смене.
  if (!on && CONFIG.adminTabs.some((t) => t.id === state.tab)) {
    state.tab = 'current';
    store.set('tab', state.tab);
  }
  if (DB.data.currentShift) { renderNav(); renderTab(); }
}

// ================= Модальное окно =================
// fill — кнопки внизу на всю ширину, одинакового размера.
function openModal(title, bodyHtml, actions, { wide = false, fill = false } = {}) {
  $('#modal .modal__card').classList.toggle('modal__card--wide', wide);
  $('#modal-actions').classList.toggle('modal__actions--fill', fill);
  $('#modal .modal__card').scrollTop = 0;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
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
  $('#modal').hidden = false;
}

function closeModal() { $('#modal').hidden = true; }

$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => {
  if ($('#modal').hidden) return;
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') $('#modal-actions .btn--primary')?.click();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================= Запуск =================
$('#btn-settings .tab__icon').innerHTML = ICONS.settings;
$('#btn-edit .edit-btn__icon').innerHTML = ICONS.edit;
tickClock();
setInterval(tickClock, 1000);

// Раз в минуту обновляем «Простой» у оборудования в ремонте (если не открыто окно).
setInterval(() => {
  if (state.tab === 'current' && (DB.data.currentShift || state.viewer) && $('#modal').hidden) renderTab();
}, 60000);

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
  if (!DB.data.currentShift && state.joined) setJoined(false);
  if (state.viewer || (DB.data.currentShift && state.joined)) showMainScreen();
  else if (!$('#screen-main').hidden) showStartScreen();
}
DB.onChange(renderApp);

// Переход со старой версии: на этом устройстве уже шла смена — считаем, что оно в ней.
state.joined = store.get('joined', undefined);
if (state.joined === undefined) setJoined(!!DB.data.currentShift);
// Вкладки режима настроек после перезагрузки недоступны.
if (!CONFIG.tabs.some((t) => t.id === state.tab)) state.tab = 'current';
renderApp();
if ($('#screen-main').hidden) showStartScreen();
