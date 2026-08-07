(() => {
  'use strict';
  const DB_NAME = 'heartline-editor-v2';
  const DB_VERSION = 1;
  const STORES = ['novels','versions','sessions','candidates','gptCycles','settings'];
  let dbPromise = null;

  function open() {
    if (!('indexedDB' in window) || !window.indexedDB) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let settled=false, req=null;
      const done=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value)};
      const timer=setTimeout(()=>done(reject,new Error('Локальная база IndexedDB не ответила за 8 секунд. Закройте другие вкладки HEARTLINE и обновите страницу.')),8000);
      try{req=indexedDB.open(DB_NAME, DB_VERSION)}catch(e){done(reject,e);return}
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('novels')) db.createObjectStore('novels', { keyPath:'novelId' });
        if (!db.objectStoreNames.contains('versions')) db.createObjectStore('versions', { keyPath:'versionId' });
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath:'sessionId' });
        if (!db.objectStoreNames.contains('candidates')) db.createObjectStore('candidates', { keyPath:'candidateId' });
        if (!db.objectStoreNames.contains('gptCycles')) db.createObjectStore('gptCycles', { keyPath:'cycleId' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath:'key' });
      };
      req.onsuccess = () => done(resolve,req.result);
      req.onerror = () => done(reject,req.error || new Error('IndexedDB недоступен'));
      req.onblocked = () => done(reject,new Error('IndexedDB заблокирована другой вкладкой HEARTLINE. Закройте другие вкладки приложения и обновите страницу.'));
    });
    return dbPromise;
  }

  const fallbackKey = (store, key) => `hl2.${store}.${key}`;
  const fallbackIndexKey = store => `hl2.${store}.__keys`;
  function fallbackKeys(store) { try { return JSON.parse(localStorage.getItem(fallbackIndexKey(store)) || '[]'); } catch (_) { return []; } }
  function fallbackWrite(store, key, value) {
    localStorage.setItem(fallbackKey(store,key), JSON.stringify(value));
    const keys = fallbackKeys(store); if (!keys.includes(key)) { keys.push(key); localStorage.setItem(fallbackIndexKey(store), JSON.stringify(keys)); }
  }
  function fallbackDelete(store,key) {
    localStorage.removeItem(fallbackKey(store,key));
    localStorage.setItem(fallbackIndexKey(store), JSON.stringify(fallbackKeys(store).filter(x=>x!==key)));
  }

  async function put(store, value) {
    const db = await open();
    if (!db) { const key = inferKey(store,value); fallbackWrite(store,key,value); return value; }
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(value);
      tx.oncomplete=()=>resolve(value); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
    });
  }
  async function get(store,key) {
    const db = await open();
    if (!db) { try { return JSON.parse(localStorage.getItem(fallbackKey(store,key)) || 'null'); } catch (_) { return null; } }
    return new Promise((resolve,reject)=>{
      const req=db.transaction(store,'readonly').objectStore(store).get(key); req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error);
    });
  }
  async function getAll(store) {
    const db = await open();
    if (!db) return fallbackKeys(store).map(k=>{try{return JSON.parse(localStorage.getItem(fallbackKey(store,k))||'null')}catch(_){return null}}).filter(Boolean);
    return new Promise((resolve,reject)=>{
      const req=db.transaction(store,'readonly').objectStore(store).getAll(); req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error);
    });
  }
  async function del(store,key) {
    const db=await open();
    if (!db){fallbackDelete(store,key);return;}
    return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
  async function clear(store) {
    const db=await open();
    if(!db){for(const k of fallbackKeys(store))fallbackDelete(store,k);return;}
    return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
  function inferKey(store,v){return ({novels:'novelId',versions:'versionId',sessions:'sessionId',candidates:'candidateId',gptCycles:'cycleId',settings:'key'})[store] && v[({novels:'novelId',versions:'versionId',sessions:'sessionId',candidates:'candidateId',gptCycles:'cycleId',settings:'key'})[store]];}
  async function exportAll(){const out={schema:'heartline-backup-v2',exportedAt:new Date().toISOString()};for(const s of STORES)out[s]=await getAll(s);return out;}
  async function importAll(payload,{replace=false}={}){
    if(!payload||payload.schema!=='heartline-backup-v2')throw new Error('Это не backup HEARTLINE v2');
    if(replace)for(const s of STORES)await clear(s);
    for(const s of STORES)for(const item of payload[s]||[])await put(s,item);
  }
  window.HEARTLINEDB={open,put,get,getAll,delete:del,clear,exportAll,importAll,stores:STORES};
})();
