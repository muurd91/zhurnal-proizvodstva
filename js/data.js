// ================= Файл данных =================
// Все данные приложения живут в одном JSON-документе. Сейчас он хранится
// локально в браузере; позже рядом появится адаптер OneDrive с тем же
// интерфейсом (load/save), и остальной код менять не придётся.

const DATA_FORMAT = 'zhurnal-proizvodstva';
const DATA_VERSION = 1;

function emptyData() {
  return {
    format: DATA_FORMAT,
    version: DATA_VERSION,
    updatedAt: null,
    currentShift: null, // { id, master, type, start }
    shifts: [],         // завершённые смены: { id, master, type, start, end }
    equipment: [],      // { id, group, name, mark, inv, pos } — pos: позиция в цеху (число или null)
    breakdowns: [],     // поломки
    repairs: [],        // заявки на ремонт: priority 'urgent' | 'planned'
    parts: [],          // склад: { id, group, kind, name, article, qty, unit, min }
    manuals: [],        // мануалы
    settings: defaultSettings(), // данные смен: мастера, номера, время
  };
}

// Мастер: { name, number }. Старый формат (просто фамилия) — без номера.
function normalizeMaster(m) {
  if (typeof m === 'string') return { name: m.trim(), number: '' };
  return { name: String(m?.name || '').trim(), number: String(m?.number || '') };
}

function defaultSettings() {
  return {
    masters: CONFIG.masters.map((m) => ({ ...m })),
    shiftNumbers: [...CONFIG.shiftNumbers],
    shiftTypes: JSON.parse(JSON.stringify(CONFIG.shiftTypes)),
  };
}

// Уникальный id, который не совпадёт между устройствами.
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Приводит документ к актуальной структуре; бросает ошибку, если это не наш файл.
function normalizeData(raw) {
  if (!raw || typeof raw !== 'object' || raw.format !== DATA_FORMAT) {
    throw new Error('Это не файл данных «Журнала производства».');
  }
  if (raw.version > DATA_VERSION) {
    throw new Error('Файл создан более новой версией приложения. Обновите страницу.');
  }
  const base = emptyData();
  const data = { ...base, ...raw, format: DATA_FORMAT, version: DATA_VERSION };
  for (const key of Object.keys(base)) {
    if (Array.isArray(base[key]) && !Array.isArray(data[key])) data[key] = [];
  }
  // Настройки смен: недостающие поля берём по умолчанию.
  const s = data.settings && typeof data.settings === 'object' ? data.settings : {};
  data.settings = {
    masters: Array.isArray(s.masters) ? s.masters.map(normalizeMaster).filter((m) => m.name) : base.settings.masters,
    shiftNumbers: Array.isArray(s.shiftNumbers) ? s.shiftNumbers : base.settings.shiftNumbers,
    shiftTypes: { ...base.settings.shiftTypes, ...(s.shiftTypes || {}) },
  };
  // Поля, появившиеся позже: в старых файлах их нет — подставляем умолчания.
  data.repairs = data.repairs.map((r) => ({ ...r, priority: r.priority === 'urgent' ? 'urgent' : 'planned' }));
  data.equipment = data.equipment.map((e) => ({ ...e, pos: Number.isFinite(e.pos) ? e.pos : null }));
  return data;
}

// ---------- Адаптер: локальная копия в браузере ----------
const LocalBackend = {
  KEY: 'jp.data',
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  save(data) {
    try { localStorage.setItem(this.KEY, JSON.stringify(data)); return true; } catch { return false; }
  },
};

// Перенос данных из старых отдельных ключей (до появления единого файла).
function migrateLegacy() {
  const data = emptyData();
  const take = (key) => {
    try {
      const v = localStorage.getItem('jp.' + key);
      localStorage.removeItem('jp.' + key);
      return v === null ? null : JSON.parse(v);
    } catch { return null; }
  };
  const shift = take('shift');
  if (shift) data.currentShift = { id: uid(), ...shift };
  data.equipment = take('equipment') || [];
  data.repairs = take('repairs') || [];
  data.parts = take('parts') || [];
  return data;
}

// ---------- Хранилище ----------
const DB = (() => {
  const backend = LocalBackend;
  const listeners = [];
  let data;

  try { data = normalizeData(backend.load()); }
  catch { data = migrateLegacy(); backend.save(data); }

  const emit = () => listeners.forEach((fn) => fn(data));

  let saveFailed = false; // последняя запись в хранилище не удалась

  let remote = null; // адаптер облака (OneDrive): localChange(), state()

  // replaceAll — файл данных загружен вручную: он заменяет и облачную копию целиком.
  function persist(replaceAll = false) {
    saveFailed = !backend.save(data);
    if (saveFailed) alert('Не удалось сохранить данные: память браузера переполнена или недоступна.');
    remote?.localChange({ replaceAll });
  }

  // Изменения из другой вкладки этого же браузера.
  window.addEventListener('storage', (e) => {
    if (e.key !== backend.KEY) return;
    try { data = normalizeData(JSON.parse(e.newValue)); emit(); } catch {}
  });

  return {
    get data() { return data; },

    // Состояние сохранения для индикатора в шапке.
    // state: 'saved' | 'error' (память устройства) | 'local' | 'auth' | 'syncing' | 'offline' | 'cloudError' (OneDrive).
    // pending — сколько изменений ждёт отправки; cloud — данные связаны с OneDrive.
    get saveState() {
      if (saveFailed) return { state: 'error', at: data.updatedAt, pending: 0 };
      const cloud = remote?.state();
      return { at: data.updatedAt, pending: 0, ...(cloud || { state: 'saved' }) };
    },

    // Подключение облака: все локальные изменения идут через persist → remote.localChange().
    attachSync(adapter) { remote = adapter; },

    // Данные, пришедшие из облака: пишем локально и показываем, но обратно не отправляем.
    applyRemote(doc) {
      data = normalizeData(doc);
      saveFailed = !backend.save(data);
      emit();
    },

    // Все изменения — только через update: он ставит время, сохраняет и оповещает.
    update(fn) {
      fn(data);
      data.updatedAt = new Date().toISOString();
      persist();
      emit();
    },

    // Полная замена (загрузка файла).
    replace(newData) {
      data = normalizeData(newData);
      persist(true);
      emit();
    },

    onChange(fn) { listeners.push(fn); },

    exportFile() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const name = `zhurnal-proizvodstva_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    async readFile(file) {
      let raw;
      try { raw = JSON.parse(await file.text()); }
      catch { throw new Error('Файл повреждён или это не JSON.'); }
      return normalizeData(raw);
    },
  };
})();
