const CACHE='heartline-editor-v3-302-story-map';
const CORE=[
  './','./index.html','./heartline-v301-app.css','./heartline-v302-graph.css','./heartline-v301-app.js',
  './heartline-v301-db.js','./heartline-v301-domain.js','./heartline-v301-engine.js',
  './heartline-v301-assets.js','./heartline-v301-player-renderer.js','./heartline-v301-graph.js',
  './heartline-v301-parser.js','./heartline-v301-exporter.js','./novel.json',
  './manifest.webmanifest','./icon-192.png','./icon-512.png'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  const isNavigation=event.request.mode==='navigate';
  const isCore=isNavigation||/heartline-v30[12]-|novel\.json$|manifest\.webmanifest$|icon-(192|512)\.png$/.test(url.pathname);
  if(!isCore)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(async()=>{
    const hit=await caches.match(event.request);
    if(hit)return hit;
    if(isNavigation)return caches.match('./index.html');
    throw new Error('Offline resource unavailable');
  }));
});
