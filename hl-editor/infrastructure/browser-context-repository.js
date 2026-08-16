import * as DB from '../../heartline-db.js';
import { reviewStateForCurrentHash } from '../domain/project.js';

const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

async function deleteProjectRecords(stores, projectId, existing) {
  for (const record of existing.versions) stores.versions.delete(record.versionId);
  for (const record of existing.sessions) stores.sessions.delete(record.sessionId);
  for (const record of existing.reviews) stores.reviews.delete(record.reviewId);
  for (const record of existing.assignments) stores.visualAssignments.delete(record.assignmentId);
  for (const record of existing.assets) {
    stores.assets.delete(record.assetId);
    stores.assetThumbnails.delete(record.assetId);
  }
  for (const record of existing.candidates) stores.gptCandidates.delete(record.candidateId);
  for (const record of existing.cycles) stores.gptCycles.delete(record.cycleId);
  for (const record of existing.changeEvents) stores.changeEvents.delete(record.eventId);
  stores.workspaceDrafts.delete(projectId);
}

export class BrowserProjectContextRepository {
  async getProject(projectId) { return DB.get('projects', projectId); }
  async getWorkspace(projectId) { return DB.get('workspaceDrafts', projectId); }
  async getBinding(projectId) { return DB.get('sourceBindings', projectId); }

  async attachSourceProject({ projectId, documentId, title, content, sourceHash, binding, existing, review, now }) {
    const currentProject = await DB.get('projects', projectId);
    const currentWorkspace = await DB.get('workspaceDrafts', projectId);
    const workingVersionId = `${projectId}::working`;
    const workingVersion = {
      versionId: workingVersionId,
      projectId,
      label: 'Working source',
      parentVersionId: null,
      sourceType: 'source-project-cache',
      cacheOnly: true,
      createdAt: (await DB.get('versions', workingVersionId))?.createdAt || now,
      updatedAt: now,
      content: clone(content),
      sourceHash
    };
    const project = {
      ...(currentProject || {}), projectId, documentId, title,
      activeVersionId: workingVersionId,
      sourceBacked: true, transportOnly: false,
      sourceHash, formatVersion: 4,
      review: reviewStateForCurrentHash(review || currentProject?.review, sourceHash),
      createdAt: currentProject?.createdAt || now, updatedAt: now
    };
    const workspace = currentWorkspace || {
      projectId, baseVersionId: workingVersionId, textEdits: {}, selectedFragmentId: null,
      selectedSceneId: content.startScene, undoStack: [], redoStack: [], dirty: false,
      saveState: 'saved', updatedAt: now
    };
    workspace.baseVersionId = workingVersionId;
    if (!workspace.dirty) {
      workspace.textEdits = {};
      workspace.saveState = 'saved';
      workspace.conflict = null;
      workspace.error = null;
    }
    workspace.updatedAt = now;
    await DB.runTransaction(['projects', 'versions', 'workspaceDrafts', 'sourceBindings'], 'readwrite', stores => {
      stores.projects.put(project);
      stores.versions.put(workingVersion);
      stores.workspaceDrafts.put(workspace);
      stores.sourceBindings.put(binding);
    });
    return { project, workspace, workingVersion };
  }

  async saveBinding(binding) { return DB.put('sourceBindings', binding); }

  async setWorkspaceState(projectId, patch) {
    const workspace = await DB.get('workspaceDrafts', projectId);
    if (!workspace) return null;
    const next = { ...workspace, ...patch };
    await DB.put('workspaceDrafts', next);
    return next;
  }

  async commitWorkspaceSave(projectId, { sourceHash, content, savedAt }) {
    const [workspace, project] = await Promise.all([DB.get('workspaceDrafts', projectId), DB.get('projects', projectId)]);
    if (!workspace || !project) return;
    const nextWorkspace = {
      ...workspace, dirty: false, saveState: 'saved', conflict: null, error: null,
      lastSavedHash: sourceHash, updatedAt: savedAt
    };
    const nextProject = {
      ...project, sourceHash, updatedAt: savedAt,
      review: reviewStateForCurrentHash(project.review, sourceHash)
    };
    await DB.runTransaction(['projects', 'workspaceDrafts'], 'readwrite', stores => {
      stores.projects.put(nextProject);
      stores.workspaceDrafts.put(nextWorkspace);
    });
  }

  async updateWorkingCache(projectId, { content, sourceHash, updatedAt }) {
    const project = await DB.get('projects', projectId);
    if (!project) return;
    const versionId = project.activeVersionId || `${projectId}::working`;
    const current = await DB.get('versions', versionId);
    const next = {
      ...(current || {}), versionId, projectId, label: current?.label || 'Working source',
      sourceType: current?.sourceType || 'source-project-cache', cacheOnly: true,
      createdAt: current?.createdAt || updatedAt, updatedAt, content: clone(content), sourceHash
    };
    await DB.put('versions', next);
  }

  async createRevisionCache(projectId, { revisionId, sourceHash, content, createdAt, reason, label = null }) {
    const versionId = `${projectId}::revision:${revisionId.replace(/\.json$/i, '')}`;
    await DB.put('versions', {
      versionId, projectId, label: label || `Revision ${createdAt}`, parentVersionId: null,
      sourceType: 'source-revision', immutable: true, createdAt, updatedAt: createdAt,
      content: clone(content), sourceHash, note: reason
    });
    try { await DB.cloneVisualScope(projectId, DB.workspaceScope(projectId), DB.versionScope(versionId)); } catch (_) {}
    return versionId;
  }

  async getLatestRevision(projectId) {
    const versions = (await DB.getAllByIndex('versions', 'projectId', projectId)).filter(version => version.sourceType === 'source-revision').sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return versions[0] || null;
  }

  async pruneRevisionCache(projectId, retention) {
    const versions = (await DB.getAllByIndex('versions', 'projectId', projectId)).filter(version => version.sourceType === 'source-revision').sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    for (const version of versions.slice(retention)) {
      await DB.deleteByIndex('visualAssignments', 'scopeId', DB.versionScope(version.versionId));
      await DB.del('versions', version.versionId);
    }
  }

  async saveRecoveryMetadata(record) { await DB.put('recovery', record); }
  async markRecoveryCommitted(recoveryId, patch) {
    const current = await DB.get('recovery', recoveryId);
    if (current) await DB.put('recovery', { ...current, ...patch, status: 'committed' });
  }

  async createSafetySnapshot(projectId, reason = 'destructive-operation') {
    const snapshot = await this.getProjectSnapshot(projectId);
    const snapshotId = `safety:${projectId}:${Date.now().toString(36)}`;
    await DB.put('safetySnapshots', { snapshotId, projectId, reason, createdAt: new Date().toISOString(), payload: snapshot });
    return snapshotId;
  }

  async getProjectSnapshot(projectId) {
    const [project, versions, workspace, sessions, reviews, assignments, assets, candidates, cycles, changeEvents] = await Promise.all([
      DB.get('projects', projectId), DB.getAllByIndex('versions', 'projectId', projectId), DB.get('workspaceDrafts', projectId),
      DB.getAllByIndex('sessions', 'projectId', projectId), DB.getAllByIndex('reviews', 'projectId', projectId),
      DB.getAllByIndex('visualAssignments', 'projectId', projectId), DB.getAllByIndex('assets', 'projectId', projectId),
      DB.getAllByIndex('gptCandidates', 'projectId', projectId), DB.getAllByIndex('gptCycles', 'projectId', projectId),
      DB.getAllByIndex('changeEvents', 'projectId', projectId)
    ]);
    return { formatVersion: 4, project, versions, workspace, sessions, reviews, assignments, assets, candidates, cycles, changeEvents };
  }

  async restoreContextCheckpoint(snapshot) {
    if (!snapshot?.project?.projectId) throw new Error('Invalid HEARTLINE context checkpoint');
    const packageData = {
      projectId: snapshot.project.projectId, project: clone(snapshot.project), versions: clone(snapshot.versions || []),
      workspace: clone(snapshot.workspace || null), sessions: clone(snapshot.sessions || []), reviews: clone(snapshot.reviews || []),
      assignments: clone(snapshot.assignments || []), assets: snapshot.assets || [], candidates: clone(snapshot.candidates || []),
      cycles: clone(snapshot.cycles || []), changeEvents: clone(snapshot.changeEvents || [])
    };
    await this.restoreProjectPackage(packageData);
    return packageData.project;
  }

  async projectExists(projectId) { return Boolean(await DB.get('projects', projectId)); }

  async markReviewState(projectId, review) {
    const project = await DB.get('projects', projectId);
    if (!project) return null;
    const next = { ...project, review: clone(review), updatedAt: new Date().toISOString() };
    await DB.put('projects', next);
    return next;
  }

  async importTransportAsNew({ projectId, title, content, validation, sourceType, now }) {
    const versionId = `${projectId}::working`;
    const project = {
      projectId, title, activeVersionId: versionId, sourceBacked: false, transportOnly: true, requiresSourceAttachment: true,
      formatVersion: 4, createdAt: now, updatedAt: now,
      review: { status: 'not-started', reviewedHash: null, reviewedAt: null }
    };
    const version = { versionId, projectId, label: 'Working import', parentVersionId: null, sourceType, cacheOnly: true, createdAt: now, updatedAt: now, content: clone(content), validation };
    const workspace = { projectId, baseVersionId: versionId, textEdits: {}, selectedFragmentId: null, selectedSceneId: content.startScene, undoStack: [], redoStack: [], dirty: false, saveState: 'saved', updatedAt: now };
    await DB.runTransaction(['projects', 'versions', 'workspaceDrafts'], 'readwrite', stores => {
      stores.projects.put(project); stores.versions.put(version); stores.workspaceDrafts.put(workspace);
    });
    return project;
  }

  async restoreProjectPackage(packageData) {
    const { projectId } = packageData;
    const existing = await this.getProjectSnapshot(projectId);
    const storesToRead = ['versions', 'sessions', 'reviews', 'visualAssignments', 'assets', 'assetThumbnails', 'gptCandidates', 'gptCycles', 'changeEvents', 'workspaceDrafts', 'projects'];
    await DB.runTransaction(storesToRead, 'readwrite', stores => {
      deleteProjectRecords(stores, projectId, existing);
      stores.projects.put(packageData.project);
      for (const value of packageData.versions || []) stores.versions.put(value);
      if (packageData.workspace) stores.workspaceDrafts.put(packageData.workspace);
      for (const value of packageData.sessions || []) stores.sessions.put(value);
      for (const value of packageData.reviews || []) stores.reviews.put(value);
      for (const value of packageData.assignments || []) stores.visualAssignments.put(value);
      for (const value of packageData.assets || []) stores.assets.put(value);
      for (const value of packageData.candidates || []) stores.gptCandidates.put(value);
      for (const value of packageData.cycles || []) stores.gptCycles.put(value);
      for (const value of packageData.changeEvents || []) stores.changeEvents.put(value);
    });
  }
}
