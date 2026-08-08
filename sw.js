const CACHE='heartline-editor-3.2.0-graph2-navigation';
const CORE=[
  './','./index.html','./heartline-app.css','./heartline-nav-fix.css','./heartline-reader-cleanup.css','./heartline-library-cards.css','./heartline-reader-hierarchy.css','./heartline-graph2.css',
  './heartline-app.js','./heartline-nav-fix.js','./heartline-project-stats.js','./heartline-graph.js','./heartline-engine.js',
  './heartline-db.js','./heartline-domain.js','./heartline-assets.js','./heartline-image-worker.js',
  './heartline-player-renderer.js','./heartline-parser.js','./heartline-exporter.js',
  './novel.json','./moon-oath.json','./manifest.webmanifest','./icon-192.png','./icon-512.png'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url); if(url.origin!==location.origin)return;
  const isNavigation=event.request.mode==='navigate';
  const isCore=isNavigation||/heartline-(?:app|nav-fix|reader-cleanup|library-cards|reader-hierarchy|graph2|project-stats|graph|engine|db|domain|assets|image-worker|player-renderer|parser|exporter)\.(?:js|css)$|(?:novel|moon-oath)\.json$|manifest\.webmanifest$|icon-(192|512)\.png$/.test(url.pathname);
  if(!isCore)return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(async()=>{const hit=await caches.match(event.request);if(hit)return hit;if(isNavigation)return caches.match('./index.html');throw new Error('Offline resource unavailable');}));
});
