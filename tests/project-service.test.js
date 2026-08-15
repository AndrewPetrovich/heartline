import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ProjectService } from '../hl-editor/application/project-service.js';
import { SourceConflictError, SourceWriteError } from '../hl-editor/ports/source-project-adapter.js';

const sha = text => createHash('sha256').update(String(text)).digest('hex');
const fixedProjectId = '11111111-1111-4111-8111-111111111111';
const fixedDocumentId = '22222222-2222-4222-8222-222222222222';

class FakeSource {
  constructor(text = '{"title":"Novel","scenes":[]}') {
    this.text = text;
    this.context = null;
    this.recoveries = new Map();
    this.revisions = new Map();
    this.backups = new Map();
    this.workspaceContext = null;
    this.failWrite = false;
  }
  async connect(rootHandle) { return { adapter: 'fake', rootHandle, sourceHandle: {}, sourcePath: 'novel.json' }; }
  async ensureContextLayout() {}
  async readContext() { return this.context; }
  async writeContext(_binding, value) { this.context = structuredClone(value); }
  async readWorkspaceContext() { return this.workspaceContext; }
  async writeWorkspaceContext(_binding, value) { this.workspaceContext = structuredClone(value); }
  async readDocument() { return { relativePath: 'novel.json', text: this.text, content: JSON.parse(this.text), title: JSON.parse(this.text).title }; }
  async writeDocumentAtomic(_binding, text) { if (this.failWrite) throw new Error('simulated crash'); this.text = text; }
  async writeRecovery(_binding, name, payload) { this.recoveries.set(name, { ...payload, status: 'pending' }); }
  async markRecoveryCommitted(_binding, name, patch) { this.recoveries.set(name, { ...this.recoveries.get(name), ...patch, status: 'committed' }); }
  async writeRevision(_binding, name, text) { this.revisions.set(name, text); }
  async writeBackup(_binding, name, payload) { this.backups.set(name, payload); }
  async pruneRevisions() {}
  async pruneBackups() {}
}

class FakeContext {
  constructor() { this.projects = new Map(); this.workspaces = new Map(); this.bindings = new Map(); this.recovery = new Map(); this.revisions = []; this.snapshots = []; this.cache = new Map(); }
  async getProject(id) { return this.projects.get(id) || null; }
  async getWorkspace(id) { return this.workspaces.get(id) || null; }
  async getBinding(id) { return this.bindings.get(id) || null; }
  async attachSourceProject({ projectId, documentId, title, content, sourceHash, binding, now, review }) {
    const project = { ...(this.projects.get(projectId) || {}), projectId, documentId, title, sourceHash, review, activeVersionId: `${projectId}::working`, updatedAt: now };
    this.projects.set(projectId, project);
    if (!this.workspaces.has(projectId)) this.workspaces.set(projectId, { projectId, baseVersionId: `${projectId}::working`, textEdits: {}, dirty: false, saveState: 'saved' });
    this.bindings.set(projectId, binding);
    this.cache.set(projectId, content);
  }
  async saveBinding(value) { this.bindings.set(value.projectId, value); }
  async setWorkspaceState(id, patch) { this.workspaces.set(id, { ...this.workspaces.get(id), ...patch }); }
  async commitWorkspaceSave(id, { sourceHash, content }) { this.workspaces.set(id, { ...this.workspaces.get(id), dirty: false, saveState: 'saved', lastSavedHash: sourceHash }); this.cache.set(id, content); this.projects.set(id, { ...this.projects.get(id), sourceHash }); }
  async updateWorkingCache(id, { content }) { this.cache.set(id, content); }
  async createRevisionCache(id, value) { this.revisions.push({ id, ...value }); }
  async getLatestRevision(id) { return this.revisions.filter(value => value.id === id).at(-1) || null; }
  async pruneRevisionCache() {}
  async saveRecoveryMetadata(value) { this.recovery.set(value.recoveryId, value); }
  async markRecoveryCommitted(id, patch) { this.recovery.set(id, { ...this.recovery.get(id), ...patch, status: 'committed' }); }
  async createSafetySnapshot(id, reason) { this.snapshots.push({ id, reason }); }
  async getProjectSnapshot(id) { return { project: this.projects.get(id), workspace: this.workspaces.get(id) }; }
  async markReviewState(id, review) { this.projects.set(id, { ...this.projects.get(id), review }); }
  async restoreContextCheckpoint(snapshot) { if (snapshot?.project) this.projects.set(snapshot.project.projectId, structuredClone(snapshot.project)); }
}

function service(source = new FakeSource(), context = new FakeContext()) {
  let uuidIndex = 0;
  const uuids = [fixedProjectId, fixedDocumentId, '33333333-3333-4333-8333-333333333333'];
  let tick = 0;
  return {
    source, context,
    instance: new ProjectService({
      sourceAdapter: source, contextRepository: context,
      hashService: { sha256Text: async text => sha(text) },
      uuid: () => uuids[uuidIndex++],
      clock: () => `2026-08-15T00:00:0${tick++}Z`,
      policies: { revisionRetention: 50, revisionMinIntervalMs: 300000, backupRetention: 10 }
    })
  };
}

test('reconnecting the same source keeps projectId', async () => {
  const env = service();
  const first = await env.instance.connectSourceProject({ name: 'root' });
  const second = await env.instance.connectSourceProject({ name: 'root' });
  assert.equal(first.projectId, fixedProjectId);
  assert.equal(second.projectId, fixedProjectId);
  assert.equal(env.context.projects.size, 1);
});

test('save creates revision and recovery then commits source', async () => {
  const env = service();
  await env.instance.connectSourceProject({});
  env.context.workspaces.set(fixedProjectId, { projectId: fixedProjectId, dirty: true, textEdits: { x: 'changed' }, saveState: 'dirty' });
  const content = { title: 'Novel', scenes: [], changed: true };
  const result = await env.instance.saveDocument({ projectId: fixedProjectId, content });
  assert.equal(result.status, 'saved');
  assert.equal(JSON.parse(env.source.text).changed, true);
  assert.equal(env.source.revisions.size, 1);
  assert.equal([...env.source.recoveries.values()][0].status, 'committed');
  assert.equal(env.context.workspaces.get(fixedProjectId).saveState, 'saved');
});

test('external modification becomes conflict and is never overwritten', async () => {
  const env = service();
  await env.instance.connectSourceProject({});
  const external = '{"title":"Novel","scenes":[],"external":true}';
  env.source.text = external;
  await assert.rejects(() => env.instance.saveDocument({ projectId: fixedProjectId, content: { title: 'Novel', scenes: [], local: true } }), SourceConflictError);
  assert.equal(env.source.text, external);
  assert.equal(env.context.workspaces.get(fixedProjectId).saveState, 'conflict');
  assert.equal(env.source.recoveries.size, 1);
});

test('failed source write leaves recovery and dirty/error state', async () => {
  const env = service();
  await env.instance.connectSourceProject({});
  const original = env.source.text;
  env.source.failWrite = true;
  await assert.rejects(() => env.instance.saveDocument({ projectId: fixedProjectId, content: { title: 'Novel', scenes: [], local: true } }), SourceWriteError);
  assert.equal(env.source.text, original);
  assert.equal([...env.source.recoveries.values()][0].status, 'pending');
  assert.equal(env.context.workspaces.get(fixedProjectId).saveState, 'error');
});


test('autosave revision policy does not create a revision on every pause', async () => {
  const env = service();
  await env.instance.connectSourceProject({});
  await env.instance.saveDocument({ projectId: fixedProjectId, content: { title: 'Novel', scenes: [], edit: 1 }, reason: 'autosave' });
  await env.instance.saveDocument({ projectId: fixedProjectId, content: { title: 'Novel', scenes: [], edit: 2 }, reason: 'autosave' });
  assert.equal(env.source.revisions.size, 1);
});

test('project context checkpoint can rehydrate the same project after local context loss', async () => {
  const first = service();
  const connected = await first.instance.connectSourceProject({});
  assert.ok(first.source.workspaceContext);
  const freshContext = new FakeContext();
  const second = service(first.source, freshContext);
  const reconnected = await second.instance.connectSourceProject({});
  assert.equal(reconnected.projectId, connected.projectId);
  assert.equal(freshContext.projects.size, 1);
});
