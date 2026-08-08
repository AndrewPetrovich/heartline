const BUILD = '2.10-2100';
const CACHE = `heartline-editor-${BUILD}`;
const PRECACHE = [
  './heartline-styles-2100.css',
  './heartline-app-2100.js',
  './storage.js?v=20260808-2100',
  './parser.js?v=20260808-2100',
  './exporter.js?v=20260808-2100',
  './builtin-novel.js?v=20260808-2100',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isCore = event.request.mode === 'navigate' || /\.(?:html|js|css)$/.test(url.pathname);
  if (isCore) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(()=>{});
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(hit => hit || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
