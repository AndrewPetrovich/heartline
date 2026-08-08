const DB_NAME = 'heartline-editor-v3';
const DB_VERSION = 3;
const OLD_DB_NAME = 'heartline-editor-v2';

const STORE_DEFS = {
  projects: { keyPath: 'projectId', indexes: [['updatedAt', 'updatedAt'], ['activeVersionId', 'activeVersionId']] },
  versions: { keyPath: 'versionId', indexes: [['projectId', 'projectId'], ['createdAt', 'createdAt']] },
  workspaceDrafts: { keyPath: 'projectId', indexes: [['baseVersionId', 'baseVersionId']] },
  sessions: { keyPath: 'sessionId', indexes: [['projectId', 'projectId'], ['versionId', 'versionId']] },
  reviews: { keyPath: 'reviewId', indexes: [['projectId', 'projectId'], ['fragmentId', 'fragmentId'], ['targetType', 'targetType'], ['status', 'status']] },
  assets: { keyPath: 'assetId', indexes: [['projectId', 'projectId'], ['sha256', 'sha256'], ['createdAt', 'createdAt']] },
  assetThumbnails: { keyPath: 'assetId', indexes: [] },
  visualAssignments: { keyPath: 'assignmentId', indexes: [['projectId', 'projectId'], ['scopeId', 'scopeId'], ['fragmentId', 'fragmentId'], ['assetId', 'assetId'], ['status', 'status']] },
  gptCandidates: { keyPath: 'candidateId', indexes: [['projectId', 'projectId'], ['baseVersionId', 'baseVersionId']] },
  gptCycles: { keyPath: 'cycleId', indexes: [['projectId', 'projectId']] },
  changeEvents: { keyPath: 'eventId', indexes: [['projectId', 'projectId'], ['fragmentId', 'fragmentId'], ['createdAt', 'createdAt']] },
  runtimeBuilds: { keyPath: 'buildId', indexes: [['projectId', 'projectId'], ['createdAt', 'createdAt']] },
  settings: { keyPath: 'key', indexes: [] },
  migrationJournal: { keyPath: 'id', indexes: [] }
};

let openPromise = null;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function openDb() {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, def] of Object.entries(STORE_DEFS)) {
        let store;
        if (!db.objectStoreNames.contains(name)) store = db.createObjectStore(name, { keyPath: def.keyPath });
        else store = request.transaction.objectStore(name);
        for (const [indexName, keyPath] of def.indexes) {
          if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, { unique: false });
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Не удалось открыть локальную базу HEARTLINE'));
    request.onblocked = () => reject(new Error('База HEARTLINE заблокирована другой вкладкой. Закройте другие вкладки и обновите страницу.'));
  });
  return openPromise;
}

export async function put(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await txDone(tx);
  return value;
}

export async function putMany(storeName, values) {
  if (!values?.length) return;
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  await txDone(tx);
}

export async function get(storeName, key) {
  const db = await openDb();
  return requestToPromise(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

export async function getAll(storeName) {
  const db = await openDb();
  return requestToPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

export async function getAllByIndex(storeName, indexName, value) {
  const db = await openDb();
  const index = db.transaction(storeName, 'readonly').objectStore(storeName).index(indexName);
  return requestToPromise(index.getAll(IDBKeyRange.only(value)));
}

export async function del(storeName, key) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await txDone(tx);
}

export async function deleteByIndex(storeName, indexName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const index = tx.objectStore(storeName).index(indexName);
  const cursorRequest = index.openCursor(IDBKeyRange.only(value));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await txDone(tx);
}

export async function clear(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await txDone(tx);
}

export async function runTransaction(storeNames, mode, callback) {
  const db = await openDb();
  const tx = db.transaction(storeNames, mode);
  const stores = Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)]));
  const result = await callback(stores, tx);
  await txDone(tx);
  return result;
}

function readStore(db, storeName) {
  if (!db.objectStoreNames.contains(storeName)) return Promise.resolve([]);
  return requestToPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

async function openOldDb() {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => finish(null), 3000);
    try {
      const request = indexedDB.open(OLD_DB_NAME);
      request.onsuccess = () => { clearTimeout(timer); finish(request.result); };
      request.onerror = () => { clearTimeout(timer); finish(null); };
      request.onblocked = () => { clearTimeout(timer); finish(null); };
      request.onupgradeneeded = () => {
        request.transaction.abort();
        clearTimeout(timer);
        finish(null);
      };
    } catch (_) {
      clearTimeout(timer);
      finish(null);
    }
  });
}

function now() { return new Date().toISOString(); }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function assignmentId(scopeId, fragmentId) { return `va:${scopeId}:${fragmentId}`; }

function makeMissingAssignments(projectId, scopeId, content) {
  const parser = window.HEARTLINEParser;
  const fragments = parser?.flattenFragments ? parser.flattenFragments(content) : [];
  return fragments
    .filter(fragment => fragment.type !== 'tech')
    .map(fragment => ({
      assignmentId: assignmentId(scopeId, fragment.fragmentId),
      projectId,
      scopeId,
      fragmentId: fragment.fragmentId,
      assetId: null,
      fit: 'cover',
      focalPoint: { x: 0.5, y: 0.5 },
      zoom: 1,
      overlayOpacity: 0.12,
      status: 'missing',
      deviceOverrides: {},
      updatedAt: now()
    }));
}

export async function migrateFromV2IfNeeded() {
  const marker = await get('migrationJournal', 'v2-to-v3');
  if (marker?.status === 'completed') return marker;
  const existingProjects = await getAll('projects');
  if (existingProjects.length) {
    const done = { id: 'v2-to-v3', status: 'skipped-existing-v3', at: now() };
    await put('migrationJournal', done);
    return done;
  }

  const oldDb = await openOldDb();
  if (!oldDb) {
    const done = { id: 'v2-to-v3', status: 'no-v2-db', at: now() };
    await put('migrationJournal', done);
    return done;
  }

  try {
    const [oldNovels, oldVersions, oldSessions, oldCandidates, oldCycles, oldSettings] = await Promise.all([
      readStore(oldDb, 'novels'),
      readStore(oldDb, 'versions'),
      readStore(oldDb, 'sessions'),
      readStore(oldDb, 'candidates'),
      readStore(oldDb, 'gptCycles'),
      readStore(oldDb, 'settings')
    ]);
    if (!oldNovels.length && !oldVersions.length) {
      const done = { id: 'v2-to-v3', status: 'empty-v2', at: now() };
      await put('migrationJournal', done);
      return done;
    }

    const versionsById = new Map(oldVersions.map(version => [version.versionId, version]));
    const projects = oldNovels.map(novel => ({
      projectId: novel.novelId,
      title: novel.title || novel.novelId,
      activeVersionId: novel.activeVersionId,
      createdAt: novel.createdAt || now(),
      updatedAt: novel.lastOpenedAt || novel.createdAt || now(),
      migratedFrom: 'heartline-editor-v2'
    }));
    const versions = oldVersions.map(version => ({
      versionId: version.versionId,
      projectId: version.novelId,
      label: version.label || version.versionId,
      parentVersionId: version.parentVersionId || null,
      sourceType: version.sourceType || 'migration-v2',
      createdAt: version.createdAt || now(),
      updatedAt: version.updatedAt || version.createdAt || now(),
      content: clone(version.content),
      validation: clone(version.validation || null),
      visualManifestVersion: 1,
      migratedFrom: 'heartline-editor-v2'
    }));

    await putMany('projects', projects);
    await putMany('versions', versions);

    const allAssignments = [];
    const workspaces = [];
    const reviews = [];
    for (const project of projects) {
      const activeVersion = versionsById.get(project.activeVersionId);
      const activeNew = versions.find(v => v.versionId === project.activeVersionId);
      if (!activeNew) continue;
      for (const version of versions.filter(v => v.projectId === project.projectId)) {
        allAssignments.push(...makeMissingAssignments(project.projectId, `version:${version.versionId}`, version.content));
      }
      allAssignments.push(...makeMissingAssignments(project.projectId, `workspace:${project.projectId}`, activeNew.content));
      const textEdits = {};
      for (const edit of activeVersion?.edits || []) textEdits[edit.fragmentId] = edit.editedText;
      workspaces.push({
        projectId: project.projectId,
        baseVersionId: project.activeVersionId,
        textEdits,
        selectedFragmentId: null,
        selectedSceneId: activeNew.content.startScene,
        undoStack: [],
        redoStack: [],
        dirty: Object.keys(textEdits).length > 0,
        updatedAt: now(),
        migratedFrom: 'heartline-editor-v2'
      });
      for (const version of oldVersions.filter(v => v.novelId === project.projectId)) {
        for (const review of version.reviews || []) {
          reviews.push({
            ...clone(review),
            reviewId: review.reviewId || `review:${crypto.randomUUID()}`,
            projectId: project.projectId,
            versionId: version.versionId,
            targetType: review.targetType || 'text',
            createdAt: review.createdAt || now(),
            updatedAt: review.updatedAt || review.createdAt || now()
          });
        }
      }
    }
    await putMany('workspaceDrafts', workspaces);
    for (let i = 0; i < allAssignments.length; i += 500) await putMany('visualAssignments', allAssignments.slice(i, i + 500));
    await putMany('reviews', reviews);

    const sessions = oldSessions.map(session => ({ ...clone(session), projectId: session.novelId || session.projectId }));
    await putMany('sessions', sessions);
    await putMany('gptCandidates', oldCandidates.map(candidate => ({ ...clone(candidate), projectId: candidate.novelId || candidate.projectId })));
    await putMany('gptCycles', oldCycles.map(cycle => ({ ...clone(cycle), projectId: cycle.novelId || cycle.projectId })));
    await putMany('settings', oldSettings);

    const done = {
      id: 'v2-to-v3',
      status: 'completed',
      at: now(),
      counts: {
        projects: projects.length,
        versions: versions.length,
        sessions: sessions.length,
        reviews: reviews.length,
        visualAssignments: allAssignments.length
      }
    };
    await put('migrationJournal', done);
    return done;
  } catch (error) {
    const failed = { id: 'v2-to-v3', status: 'failed', at: now(), error: String(error?.message || error) };
    await put('migrationJournal', failed);
    throw error;
  } finally {
    oldDb.close();
  }
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export function workspaceScope(projectId) { return `workspace:${projectId}`; }
export function versionScope(versionId) { return `version:${versionId}`; }
export function visualAssignmentId(scopeId, fragmentId) { return assignmentId(scopeId, fragmentId); }

export async function ensureVisualAssignments(projectId, scopeId, content) {
  const existing = await getAllByIndex('visualAssignments', 'scopeId', scopeId);
  const existingIds = new Set(existing.map(item => item.fragmentId));
  const missing = makeMissingAssignments(projectId, scopeId, content).filter(item => !existingIds.has(item.fragmentId));
  for (let i = 0; i < missing.length; i += 500) await putMany('visualAssignments', missing.slice(i, i + 500));
  return existing.concat(missing);
}

export async function cloneVisualScope(projectId, fromScopeId, toScopeId) {
  const source = await getAllByIndex('visualAssignments', 'scopeId', fromScopeId);
  await deleteByIndex('visualAssignments', 'scopeId', toScopeId);
  const cloned = source.map(item => ({ ...clone(item), assignmentId: assignmentId(toScopeId, item.fragmentId), projectId, scopeId: toScopeId, updatedAt: now() }));
  for (let i = 0; i < cloned.length; i += 500) await putMany('visualAssignments', cloned.slice(i, i + 500));
  return cloned;
}

export async function exportDatabaseMetadata(projectId) {
  const [project, versions, workspace, reviews, assignments, assets, candidates, cycles, sessions] = await Promise.all([
    get('projects', projectId),
    getAllByIndex('versions', 'projectId', projectId),
    get('workspaceDrafts', projectId),
    getAllByIndex('reviews', 'projectId', projectId),
    getAllByIndex('visualAssignments', 'projectId', projectId),
    getAllByIndex('assets', 'projectId', projectId),
    getAllByIndex('gptCandidates', 'projectId', projectId),
    getAllByIndex('gptCycles', 'projectId', projectId),
    getAllByIndex('sessions', 'projectId', projectId)
  ]);
  return { schema: 'heartline-project-v3', exportedAt: now(), project, versions, workspace, reviews, assignments, assets: assets.map(({ blob, ...asset }) => asset), candidates, cycles, sessions };
}
