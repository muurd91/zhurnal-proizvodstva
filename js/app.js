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
  admin: false,                     // режим настроек, не сохраняется
  editing: false,                   // редактирование текущей вкладки (только в режиме настроек)
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
  DB.update((d) => {
    d.currentShift = { id: uid(), master, type: formType, start: plannedStart(formType).toISOString() };
  });
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
  const shift = DB.data.currentShift;
  if (!shift) return;
  const { master, type } = shift;
  const start = new Date(shift.start);
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
  const { repairs, parts } = DB.data;
  return {
    repair: repairs.length ? 'red' : null,
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
  const tab = CONFIG.tabs.find((t) => t.id === state.tab) || CONFIG.tabs[0];
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
  edit.hidden = !state.admin;
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
  return getGroups().map((g) => `
    <section class="eq-group">
      <h3 class="eq-group__title">${escapeHtml(g)}</h3>
      <div class="eq-list">
        ${list.filter((e) => e.group === g)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
          .map((e) => `
          <button class="eq-item" data-eq="${e.id}">
            <span class="eq-item__name">${escapeHtml(e.name)}</span>
            <span class="eq-item__meta">
              ${e.mark ? `<span>Маркировка: <b>${escapeHtml(e.mark)}</b></span>` : ''}
              ${e.inv ? `<span>Инв. №: <b>${escapeHtml(e.inv)}</b></span>` : ''}
            </span>
          </button>`).join('')}
      </div>
    </section>`).join('');
}

const TAB_VIEWS = { equipment: equipmentView };

$('#panel').addEventListener('click', (e) => {
  const item = e.target.closest('[data-eq]');
  if (!item) return;
  const eq = getEquipment().find((x) => x.id === item.dataset.eq);
  if (state.admin) return openEquipmentForm(eq);
  openModal(eq.name, '<p class="muted">История поломок появится, когда будет готова вкладка «Текущая смена».</p>', [
    { label: 'Закрыть', primary: true },
  ]);
});

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
        setAdmin(false);
        DB.update((d) => {
          if (d.currentShift) d.shifts.push({ ...d.currentShift, end: new Date().toISOString() });
          d.currentShift = null;
        });
      },
    },
  ]);
});

// ================= Настройки =================
$('#btn-settings').addEventListener('click', () => {
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
        <li>Данные смен</li>
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
  if (DB.data.currentShift) renderTab();
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
$('#btn-edit .edit-btn__icon').innerHTML = ICONS.edit;
tickClock();
setInterval(tickClock, 1000);

// Экран всегда следует за данными: смена началась/закончилась (в том числе на другом устройстве) —
// переключаемся; поменялись данные — перерисовываем.
function renderApp() {
  if (DB.data.currentShift) showMainScreen();
  else if (!$('#screen-main').hidden) showStartScreen();
}
DB.onChange(renderApp);
if (DB.data.currentShift) showMainScreen(); else showStartScreen();
