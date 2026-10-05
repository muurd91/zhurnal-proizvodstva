// Заранее заданные настройки приложения.
// Позже это будет редактироваться из раздела «Настройки».
const CONFIG = {
  masters: ['Иванов', 'Петров', 'Сидоров'],

  shiftTypes: {
    day:   { label: 'Дневная', start: '08:00', end: '20:00' },
    night: { label: 'Ночная',  start: '20:00', end: '08:00' },
  },

  // Временные учётные данные для входа в настройки.
  admin: { login: 'admin', password: 'admin' },

  tabs: [
    { id: 'current',   label: 'Текущая смена',        icon: 'current',   fab: 'add' },
    { id: 'history',   label: 'История смен',         icon: 'history' },
    { id: 'equipment', label: 'Перечень оборудования', icon: 'equipment' },
    { id: 'repair',    label: 'Необходимый ремонт',   icon: 'repair',    fab: 'add' },
    { id: 'warehouse', label: 'Склад',                icon: 'warehouse', fab: 'add' },
    { id: 'manuals',   label: 'Мануалы',              icon: 'manuals',   fab: 'search' },
  ],
};
