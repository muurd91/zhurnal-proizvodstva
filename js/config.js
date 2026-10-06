// Настройки приложения.
// masters, shiftTypes и shiftNumbers — только значения по умолчанию для нового файла данных;
// дальше они хранятся в файле данных и меняются во вкладке «Данные смен» (режим настроек).
const CONFIG = {
  masters: ['Иванов', 'Петров', 'Сидоров'],

  shiftNumbers: ['1', '2', '3', '4'],

  shiftTypes: {
    day:   { label: 'Дневная', start: '08:00', end: '20:00' },
    night: { label: 'Ночная',  start: '20:00', end: '08:00' },
  },

  // Подтипы поломок.
  breakdownTypes: ['Механика', 'Электрика', 'Гидравлика', 'Пневматика', 'Электроника', 'Другое'],

  // Временные учётные данные для входа в настройки.
  admin: { login: '1', password: '1' },

  tabs: [
    { id: 'current',   label: 'Текущая смена',        icon: 'current',   fab: 'add' },
    { id: 'history',   label: 'История смен',         icon: 'history' },
    { id: 'equipment', label: 'Перечень оборудования', icon: 'equipment' },
    { id: 'repair',    label: 'Необходимый ремонт',   icon: 'repair',    fab: 'add' },
    { id: 'warehouse', label: 'Склад',                icon: 'warehouse', fab: 'add' },
    { id: 'manuals',   label: 'Мануалы',              icon: 'manuals',   fab: 'search' },
  ],

  // Вкладки, которые видны только в режиме настроек.
  adminTabs: [
    { id: 'shifts', label: 'Данные смен', icon: 'shifts' },
  ],
};
