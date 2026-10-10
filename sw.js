// ================= Service worker: офлайн-оболочка приложения =================
// Кэшируются только файлы приложения. Данные (поломки, склад и т.д.) лежат в localStorage,
// копия в OneDrive (запросы к Microsoft — другой origin); service worker их не трогает.
//
// При любом изменении файлов приложения поднимать VERSION — иначе планшет будет держать старую копию.
// Новый файл manuals/kb-*.js — добавить в SHELL.
const VERSION = 'v46';
const CACHE = `jp-shell-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/config.js',
  'js/data.js',
  'js/onedrive.js',
  'js/icons.js',
  'js/app.js',
  'manuals/kb.js',
  'manuals/kb-sigma-common.js',
  'manuals/kb-omron.js',
  'manuals/kb-yaskawa.js',
  'manuals/kb-atlas-copco.js',
  'manuals/kb-cross-air.js',
  'manuals/kb-shini.js',
  'manuals/kb-delta.js',
  'manuals/kb-hcfa.js',
  'manuals/kb-mitsubishi.js',
  'manuals/kb-invt.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

// Старые версии кэша удаляем.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jp-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Страница — «сначала сеть»: обновления приходят сразу, без сети открывается сохранённая копия.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone(); // копию — сразу, пока ответ не отдан странице
          if (res.ok) caches.open(CACHE).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html')),
    );
    return;
  }

  // Остальное — из кэша сразу, а в фоне подтягиваем свежую версию на следующий раз.
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
