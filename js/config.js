// Настройки приложения.
// masters, shiftTypes и shiftNumbers — только значения по умолчанию для нового файла данных;
// дальше они хранятся в файле данных и меняются во вкладке «Данные смен» (режим настроек).
const CONFIG = {
  // Мастер привязан к номеру смены: при начале смены номер подставляется сам.
  masters: [
    { name: 'Иванов', number: '1' },
    { name: 'Петров', number: '2' },
    { name: 'Сидоров', number: '3' },
  ],

  shiftNumbers: ['1', '2', '3', '4'],

  shiftTypes: {
    day:   { label: 'Дневная', start: '08:00', end: '20:00' },
    night: { label: 'Ночная',  start: '20:00', end: '08:00' },
  },

  // Синхронизация с Firebase (Firestore), проект общий с «Табелем смены». Конфиг веб-приложения — не секрет:
  // он виден любому в браузере, а доступ к данным закрывают правила Firestore и вход через Google.
  // Все данные лежат одним документом users/<uid>/apps/zhurnal.
  firebase: {
    app: {
      apiKey: 'AIzaSyC5vxVP5eH-_8C2q3UEB9JhiJYslD7Zxgk',
      authDomain: 'proizvodstvo-8934e.firebaseapp.com',
      projectId: 'proizvodstvo-8934e',
      storageBucket: 'proizvodstvo-8934e.firebasestorage.app',
      messagingSenderId: '502899625438',
      appId: '1:502899625438:web:3cabbf6696fb712b5c614f',
    },
  },

  // Статусы оборудования. Цвет у каждого свой (см. --status-* в style.css): работает — зелёный,
  // в ремонте — красный, обслуживание — жёлтый. Надписи на экране пока прежние;
  // «Обслуживание» заведено заранее, логика (плановое ТО) будет позже.
  equipmentStatuses: {
    ok:          { label: 'Работает',    color: 'зелёный' },
    repair:      { label: 'В ремонте',   color: 'красный' },
    maintenance: { label: 'Обслуживание', color: 'жёлтый' },
  },

  // Единицы измерения запчастей на складе.
  units: ['шт', 'м', 'кг', 'л', 'компл', 'упак'],

  // Подтипы поломок.
  breakdownTypes: ['Механика', 'Электрика', 'Гидравлика', 'Пневматика', 'Электроника', 'Другое'],

  // Замечания мастеров: виды и статусы (читает их только режим настроек).
  feedbackKinds: { bug: 'Ошибка', hard: 'Неудобно', idea: 'Идея' },
  feedbackStatuses: { new: 'Новое', work: 'В работе', done: 'Сделано' },

  // Временные учётные данные для входа в настройки.
  admin: { login: '1', password: '1' },

  // label — короткая подпись на вкладке, title — полное название (подсказка и заголовок панели),
  // fab — подпись кнопки добавления внизу справа.
  tabs: [
    { id: 'current',   label: 'Смена',        title: 'Текущая смена',         icon: 'current',   fab: 'Остановка' },
    { id: 'history',   label: 'История',      title: 'История смен',          icon: 'history' },
    { id: 'equipment', label: 'Оборудование', title: 'Оборудование', icon: 'equipment' },
    { id: 'repair',    label: 'Заявки',       title: 'Необходимый ремонт',    icon: 'repair',    fab: 'Заявка' },
    { id: 'warehouse', label: 'Склад',        title: 'Склад',                 icon: 'warehouse', fab: 'Запчасть' },
    { id: 'manuals',   label: 'Мануалы',      title: 'Мануалы',               icon: 'manuals' },
  ],

  // Вкладки, которые видны только в режиме настроек.
  adminTabs: [
    { id: 'shifts', label: 'Данные смен', title: 'Данные смен', icon: 'shifts' },
    { id: 'feedback', label: 'Замечания', title: 'Замечания мастеров', icon: 'feedback' },
  ],
};
