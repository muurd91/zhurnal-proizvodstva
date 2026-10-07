// ================= База знаний по мануалам =================
// Каждый мануал — отдельный файл kb-*.js, который вызывает KB_ADD({...}).
// Подключение нового мануала: положить файл рядом и добавить <script> в index.html.
//
// Мануал: { id, maker, model, title, kind, lang, file, note, entries: [...] }
// Запись: { code?, kind: 'alarm' | 'warning' | 'symptom', title, causes[], steps[], page, kw? }
//   code  — как на дисплее; можно перечислять через запятую или диапазоном «E50…E59»;
//   page  — страница PDF-оригинала; kw — дополнительные слова для поиска.

const MANUALS_KB = [];

function KB_ADD(manual) {
  manual.entries.forEach((e, i) => {
    e.id = `${manual.id}#${i}`;
    e.manualId = manual.id;
    e.codes = expandCodes(e.code || '');
  });
  MANUALS_KB.push(manual);
}

// «A.710» → «a710»; «E 07» → «e07»
const normCode = (s) => String(s).toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
// Без ведущих нулей в числовой части: «e07» → «e7», «a0b0» не трогаем.
const stripZeros = (s) => s.replace(/^([a-zа-яё.]*?)0+(\d)/, '$1$2');

// Все варианты написания кода записи: перечисления и диапазоны раскрываются.
function expandCodes(code) {
  const out = new Set();
  for (const part of code.split(/\s*,\s*/).filter(Boolean)) {
    const range = part.split(/\s*(?:…|\.\.\.)\s*/);
    if (range.length === 2) {
      const a = normCode(range[0]).match(/^(.*?)(\d+)$/);
      const b = normCode(range[1]).match(/^(.*?)(\d+)$/);
      if (a && b && a[1] === b[1]) {
        const width = a[2].length;
        for (let n = Number(a[2]); n <= Number(b[2]); n++) out.add(a[1] + String(n).padStart(width, '0'));
        continue;
      }
    }
    out.add(normCode(part));
  }
  return [...out].filter(Boolean);
}

// Отсечение одного русского окончания (и «-ся»), чтобы «давления» находило «давление».
// Основа не короче 4 букв — иначе «перегрев» и «перегрузка» сливаются.
const RU_ENDING = /(ами|ями|ого|его|ому|ему|ыми|ими|ой|ей|ий|ый|ая|яя|ое|ее|ых|их|ов|ев|ом|ем|ам|ям|ах|ях|ую|юю|а|я|о|е|ы|и|у|ю|ь)$/;
function stem(w) {
  let s = w.replace(/(ся|сь)$/, '');
  const cut = s.replace(RU_ENDING, '');
  if (cut.length >= 4) s = cut;
  return s.length >= 3 ? s : w;
}

// Поиск: сначала точное совпадение кода, затем совпадения по словам.
// filter: { maker?, manualId? }. Возвращает [{ entry, manual, score }].
function kbSearch(query, filter = {}) {
  const manuals = MANUALS_KB.filter((m) =>
    (!filter.maker || m.maker === filter.maker) && (!filter.manualId || m.id === filter.manualId));
  const q = query.trim();
  if (!q) return [];
  const nq = normCode(q);
  const nqz = stripZeros(nq);
  // Слово целиком весит больше, чем совпадение только по основе.
  const words = q.toLowerCase().split(/[^a-zа-яё0-9]+/).filter((w) => w.length >= 3).map((w) => ({ w, s: stem(w) }));

  const results = [];
  for (const m of manuals) {
    for (const e of m.entries) {
      let score = 0;
      if (nq && e.codes.some((c) => c === nq || stripZeros(c) === nqz)) score += 1000;
      // Код без буквенной приставки: «710» → «A.710», «E1» → «AL.E1».
      else if (nq.length >= 2 && e.codes.some((c) => c.endsWith(nq) && /^[a-zа-яё]+$/.test(c.slice(0, -nq.length)))) score += 500;
      else if (nq.length >= 2 && e.codes.some((c) => c.startsWith(nq))) score += 300;

      if (words.length) {
        const title = e.title.toLowerCase();
        const hay = [e.title, e.code || '', ...e.causes, ...e.steps, e.kw || '', m.model].join(' ').toLowerCase();
        let hit = 0;
        for (const { w, s } of words) {
          if (hay.includes(w)) { hit++; score += 10; if (title.includes(w)) score += 8; }
          else if (hay.includes(s)) { hit++; score += 4; if (title.includes(s)) score += 2; }
        }
        if (hit === words.length && words.length > 1) score += 15; // нашлись все слова
      }
      if (score > 0) results.push({ entry: e, manual: m, score });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}
