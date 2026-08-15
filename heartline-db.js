const DB_NAME = 'heartline-editor-v3';
const DB_VERSION = 4;
const OLD_DB_NAME = 'heartline-editor-v2';

const STORE_DEFS = {
  projects: { keyPath: 'projectId', indexes: [['updatedAt', 'updatedAt'], ['activeVersionId', 'activeVersionId']] },
  versions: { keyPath: 'versionId', indexes: [['projectId', 'projectId'], ['createdAt', 'createdAt']] },
  workspaceDrafts: { keyPath: 'projectId', indexes: [['baseVersionId', 'baseVersionId']] },
  sessions: { keyPath: 'sessionId', indexes: [['projectId', 'projectId'], ['versionId', 'versionId']] },
  reviews: { keyPath: 'reviewId', indexes: [['projectId', 'projectId'], ['fragmentId', 'fragmentId'], ['targetType', 'targetType'], ['status', 'status']] },
  assets: { keyPath: 'assetId', indexes: [['projectId', 'projectId'], ['sha256', 'sha256'], ['createdAt', 'createdAt']] },
  assetThumbnails: { keyPath: 'assetId', indexes: [['projectId', 'projectId']] },
  visualAssignments: { keyPath: 'assignmentId', indexes: [['projectId', 'projectId'], ['scopeId', 'scopeId'], ['fragmentId', 'fragmentId'], ['assetId', 'assetId'], ['status', 'status']] },
  gptCandidates: { keyPath: 'candidateId', indexes: [['projectId', 'projectId'], ['baseVersionId', 'baseVersionId']] },
  gptCycles: { keyPath: 'cycleId', indexes: [['projectId', 'projectId']] },
  changeEvents: { keyPath: 'eventId', indexes: [['projectId', 'projectId'], ['fragmentId', 'fragmentId'], ['createdAt', 'createdAt']] },
  runtimeBuilds: { keyPath: 'buildId', indexes: [['projectId', 'projectId'], ['createdAt', 'createdAt']] },
  settings: { keyPath: 'key', indexes: [] },
  migrationJournal: { keyPath: 'id', indexes: [] },
  sourceBindings: { keyPath: 'projectId', indexes: [['documentId', 'documentId'], ['updatedAt', 'updatedAt']] },
  recovery: { keyPath: 'recoveryId', indexes: [['projectId', 'projectId'], ['documentId', 'documentId'], ['status', 'status'], ['createdAt', 'createdAt']] },
  safetySnapshots: { keyPath: 'snapshotId', indexes: [['projectId', 'projectId'], ['createdAt', 'createdAt'], ['reason', 'reason']] },
  contextMeta: { keyPath: 'key', indexes: [] }
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

function emitMutation(storeName, operation, key = null, projectId = null) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent('heartline:db-write', { detail: { storeName, operation, key, projectId } }));
}

function keyFor(storeName, value) {
  const keyPath = STORE_DEFS[storeName]?.keyPath;
  return keyPath && value ? value[keyPath] : null;
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
      db.onversionchange = () => { db.close(); openPromise = null; };
      resolve(db);
    };
    request.onerror = () => { openPromise = null; reject(request.error || new Error('Не удалось открыть локальную базу HEARTLINE')); };
    request.onblocked = () => reject(new Error('База HEARTLINE заблокирована другой вкладкой. Закройте другие вкладки и обновите страницу.'));
  });
  return openPromise;
}

export async function put(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await txDone(tx);
  emitMutation(storeName, 'put', keyFor(storeName, value), value?.projectId || (storeName === 'projects' ? value?.projectId : null));
  return value;
}

export async function putMany(storeName, values) {
  if (!values?.length) return;
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  await txDone(tx);
  for (const value of values) emitMutation(storeName, 'put', keyFor(storeName, value), value?.projectId || (storeName === 'projects' ? value?.projectId : null));
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
  emitMutation(storeName, 'delete', key);
}

export async function deleteByIndex(storeName, indexName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const index = tx.objectStore(storeName).index(indexName);
  const deleted = [];
  const cursorRequest = index.openCursor(IDBKeyRange.only(value));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    deleted.push(cursor.primaryKey);
    cursor.delete();
    cursor.continue();
  };
  await txDone(tx);
  for (const key of deleted) emitMutation(storeName, 'delete', key, indexName === 'projectId' ? value : null);
}

export async function clear(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await txDone(tx);
  emitMutation(storeName, 'clear', null);
}

export async function runTransaction(storeNames, mode, callback) {
  const db = await openDb();
  const tx = db.transaction(storeNames, mode);
  const stores = Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)]));
  let result;
  try { result = await callback(stores, tx); }
  catch (error) { try { tx.abort(); } catch (_) {} throw error; }
  await txDone(tx);
  if (mode === 'readwrite') for (const storeName of storeNames) emitMutation(storeName, 'transaction', null);
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
      request.onupgradeneeded = () => { request.transaction.abort(); clearTimeout(timer); finish(null); };
    } catch (_) { clearTimeout(timer); finish(null); }
  });
}

function now() { return new Date().toISOString(); }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function assignmentId(scopeId, fragmentId) { return `va:${scopeId}:${fragmentId}`; }

function makeMissingAssignments(projectId, scopeId, content) {
  const parser = typeof window !== 'undefined' ? window.HEARTLINEParser : null;
  const fragments = parser?.flattenFragments ? parser.flattenFragments(content) : [];
  return fragments.filter(fragment => fragment.type !== 'tech').map(fragment => ({
    assignmentId: assignmentId(scopeId, fragment.fragmentId), projectId, scopeId, fragmentId: fragment.fragmentId,
    assetId: null, fit: 'cover', focalPoint: { x: 0.5, y: 0.5 }, zoom: 1, overlayOpacity: 0.12,
    status: 'missing', deviceOverrides: {}, updatedAt: now()
  }));
}

async function currentIntegrityIssues() {
  const projects = await getAll('projects');
  const issues = [];
  for (const project of projects) {
    const [version, workspace] = await Promise.all([get('versions', project.activeVersionId), get('workspaceDrafts', project.projectId)]);
    if (!version) issues.push({ projectId: project.projectId, kind: 'missing-active-version' });
    if (!workspace) issues.push({ projectId: project.projectId, kind: 'missing-workspace' });
  }
  return { projects, issues };
}

function buildV2Migration(oldNovels, oldVersions, oldSessions, oldCandidates, oldCycles, oldSettings, targetProjectIds) {
  const versionsById = new Map(oldVersions.map(version => [version.versionId, version]));
  const projects = oldNovels.filter(novel => targetProjectIds.has(novel.novelId)).map(novel => ({
    projectId: novel.novelId, title: novel.title || novel.novelId, activeVersionId: novel.activeVersionId,
    createdAt: novel.createdAt || now(), updatedAt: novel.lastOpenedAt || novel.createdAt || now(),
    migratedFrom: 'heartline-editor-v2', formatVersion: 4
  }));
  const projectIds = new Set(projects.map(project => project.projectId));
  const versions = oldVersions.filter(version => projectIds.has(version.novelId)).map(version => ({
    versionId: version.versionId, projectId: version.novelId, label: version.label || version.versionId,
    parentVersionId: version.parentVersionId || null, sourceType: version.sourceType || 'migration-v2',
    createdAt: version.createdAt || now(), updatedAt: version.updatedAt || version.createdAt || now(),
    content: clone(version.content), validation: clone(version.validation || null), visualManifestVersion: 1,
    migratedFrom: 'heartline-editor-v2'
  }));
  const allAssignments = [];
  const workspaces = [];
  const reviews = [];
  for (const project of projects) {
    const activeVersion = versionsById.get(project.activeVersionId);
    const activeNew = versions.find(version => version.versionId === project.activeVersionId);
    if (!activeNew) continue;
    for (const version of versions.filter(value => value.projectId === project.projectId)) allAssignments.push(...makeMissingAssignments(project.projectId, `version:${version.versionId}`, version.content));
    allAssignments.push(...makeMissingAssignments(project.projectId, `workspace:${project.projectId}`, activeNew.content));
    const textEdits = {};
    for (const edit of activeVersion?.edits || []) textEdits[edit.fragmentId] = edit.editedText;
    workspaces.push({
      projectId: project.projectId, baseVersionId: project.activeVersionId, textEdits, selectedFragmentId: null,
      selectedSceneId: activeNew.content.startScene, undoStack: [], redoStack: [], dirty: Object.keys(textEdits).length > 0,
      saveState: Object.keys(textEdits).length ? 'dirty' : 'saved', updatedAt: now(), migratedFrom: 'heartline-editor-v2'
    });
    for (const version of oldVersions.filter(value => value.novelId === project.projectId)) {
      for (const review of version.reviews || []) reviews.push({
        ...clone(review), reviewId: review.reviewId || `review:${crypto.randomUUID()}`, projectId: project.projectId,
        versionId: version.versionId, targetType: review.targetType || 'text', createdAt: review.createdAt || now(),
        updatedAt: review.updatedAt || review.createdAt || now()
      });
    }
  }
  return {
    projects, versions, workspaces, reviews, assignments: allAssignments,
    sessions: oldSessions.filter(value => projectIds.has(value.novelId || value.projectId)).map(value => ({ ...clone(value), projectId: value.novelId || value.projectId })),
    candidates: oldCandidates.filter(value => projectIds.has(value.novelId || value.projectId)).map(value => ({ ...clone(value), projectId: value.novelId || value.projectId })),
    cycles: oldCycles.filter(value => projectIds.has(value.novelId || value.projectId)).map(value => ({ ...clone(value), projectId: value.novelId || value.projectId })),
    settings: oldSettings
  };
}

export async function migrateFromV2IfNeeded() {
  const marker = await get('migrationJournal', 'v2-to-v4');
  if (marker?.status === 'completed') return marker;
  const integrity = await currentIntegrityIssues();
  if (integrity.projects.length && !integrity.issues.length) {
    const done = { id: 'v2-to-v4', status: 'completed', result: 'existing-v3-v4-valid', at: now() };
    await put('migrationJournal', done);
    return done;
  }

  const oldDb = await openOldDb();
  if (!oldDb) {
    if (integrity.issues.length) {
      const failed = { id: 'v2-to-v4', status: 'failed', at: now(), error: 'Current database is incomplete and v2 source database is unavailable', issues: integrity.issues };
      await put('migrationJournal', failed);
      throw new Error('Локальная база HEARTLINE неполна, а исходная v2-база недоступна для восстановления');
    }
    const done = { id: 'v2-to-v4', status: 'completed', result: 'no-v2-db', at: now() };
    await put('migrationJournal', done);
    return done;
  }

  try {
    const [oldNovels, oldVersions, oldSessions, oldCandidates, oldCycles, oldSettings] = await Promise.all([
      readStore(oldDb, 'novels'), readStore(oldDb, 'versions'), readStore(oldDb, 'sessions'),
      readStore(oldDb, 'candidates'), readStore(oldDb, 'gptCycles'), readStore(oldDb, 'settings')
    ]);
    if (!oldNovels.length && !oldVersions.length) {
      const done = { id: 'v2-to-v4', status: 'completed', result: 'empty-v2', at: now() };
      await put('migrationJournal', done);
      return done;
    }

    const brokenIds = new Set(integrity.issues.map(issue => issue.projectId));
    const currentIds = new Set(integrity.projects.map(project => project.projectId));
    const targetIds = new Set(oldNovels.map(novel => novel.novelId).filter(id => !currentIds.has(id) || brokenIds.has(id)));
    if (!targetIds.size) {
      const done = { id: 'v2-to-v4', status: 'completed', result: 'nothing-to-repair', at: now() };
      await put('migrationJournal', done);
      return done;
    }

    const safetyId = `migration-safety:${Date.now().toString(36)}`;
    await put('safetySnapshots', { snapshotId: safetyId, projectId: '__migration__', reason: 'pre-v2-to-v4', createdAt: now(), payload: { projects: integrity.projects, issues: integrity.issues } });
    const migrated = buildV2Migration(oldNovels, oldVersions, oldSessions, oldCandidates, oldCycles, oldSettings, targetIds);
    const markerValue = {
      id: 'v2-to-v4', status: 'completed', at: now(), safetySnapshotId: safetyId,
      counts: { projects: migrated.projects.length, versions: migrated.versions.length, sessions: migrated.sessions.length, reviews: migrated.reviews.length, visualAssignments: migrated.assignments.length }
    };

    await runTransaction(['projects', 'versions', 'workspaceDrafts', 'sessions', 'reviews', 'visualAssignments', 'gptCandidates', 'gptCycles', 'settings', 'migrationJournal'], 'readwrite', stores => {
      for (const value of migrated.projects) stores.projects.put(value);
      for (const value of migrated.versions) stores.versions.put(value);
      for (const value of migrated.workspaces) stores.workspaceDrafts.put(value);
      for (const value of migrated.sessions) stores.sessions.put(value);
      for (const value of migrated.reviews) stores.reviews.put(value);
      for (const value of migrated.assignments) stores.visualAssignments.put(value);
      for (const value of migrated.candidates) stores.gptCandidates.put(value);
      for (const value of migrated.cycles) stores.gptCycles.put(value);
      for (const value of migrated.settings) stores.settings.put(value);
      stores.migrationJournal.put(markerValue);
    });
    return markerValue;
  } catch (error) {
    const failed = { id: 'v2-to-v4', status: 'failed', at: now(), error: String(error?.message || error) };
    await put('migrationJournal', failed);
    throw error;
  } finally { oldDb.close(); }
}

export function notifyProjectChanged(projectId, operation = 'context-change') { emitMutation('projectContext', operation, projectId, projectId); }

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
  for (let index = 0; index < missing.length; index += 500) await putMany('visualAssignments', missing.slice(index, index + 500));
  return existing.concat(missing);
}

export async function cloneVisualScope(projectId, fromScopeId, toScopeId) {
  const source = await getAllByIndex('visualAssignments', 'scopeId', fromScopeId);
  await deleteByIndex('visualAssignments', 'scopeId', toScopeId);
  const cloned = source.map(item => ({ ...clone(item), assignmentId: assignmentId(toScopeId, item.fragmentId), projectId, scopeId: toScopeId, updatedAt: now() }));
  for (let index = 0; index < cloned.length; index += 500) await putMany('visualAssignments', cloned.slice(index, index + 500));
  return cloned;
}

export async function exportDatabaseMetadata(projectId) {
  const [project, versions, workspace, reviews, assignments, assets, candidates, cycles, sessions, sourceBinding, recoveries] = await Promise.all([
    get('projects', projectId), getAllByIndex('versions', 'projectId', projectId), get('workspaceDrafts', projectId),
    getAllByIndex('reviews', 'projectId', projectId), getAllByIndex('visualAssignments', 'projectId', projectId),
    getAllByIndex('assets', 'projectId', projectId), getAllByIndex('gptCandidates', 'projectId', projectId),
    getAllByIndex('gptCycles', 'projectId', projectId), getAllByIndex('sessions', 'projectId', projectId),
    get('sourceBindings', projectId), getAllByIndex('recovery', 'projectId', projectId)
  ]);
  const bindingMetadata = sourceBinding ? { ...sourceBinding, rootHandle: undefined, sourceHandle: undefined } : null;
  return { schema: 'heartline-project-v4', formatVersion: 4, exportedAt: now(), project, versions, workspace, reviews, assignments, assets: assets.map(({ blob, ...asset }) => asset), candidates, cycles, sessions, sourceBinding: bindingMetadata, recoveries };
}
