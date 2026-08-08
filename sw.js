const CACHE = 'heartline-editor-v3-300';
const CORE = [
  './', './index.html', './app-v300/app.css',
  './app-v300/app.js', './app-v300/db.js', './app-v300/domain.js', './app-v300/engine.js',
  './app-v300/assets.js', './app-v300/player-renderer.js', './app-v300/graph.js',
  './legacy/parser.js', './legacy/exporter.js', './novel.json', './manifest.webmanifest',
  './icon-192.png', './icon-512.png'
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put('./index.html', copy));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  const versioned = url.pathname.includes('/app-v300/') || url.pathname.includes('/legacy/') || /novel\.json$/.test(url.pathname);
  if (versioned) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    })));
  }
});
