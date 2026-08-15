import * as DB from '../../../heartline-db.js';
import * as Domain from '../../../heartline-domain.js';

const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

export class BrowserProofreadingRepository {
  async getMostRecentProject() {
    const projects = await DB.getAll('projects');
    return projects.sort((a, b) => String(b.lastOpenedAt || b.updatedAt || '').localeCompare(String(a.lastOpenedAt || a.updatedAt || '')))[0] || null;
  }

  async getProjectBundle(projectId) {
    const project = await DB.get('projects', projectId);
    if (!project) return null;
    const [version, workspace, reviews, changes, binding] = await Promise.all([
      DB.get('versions', project.activeVersionId),
      DB.get('workspaceDrafts', projectId),
      DB.getAllByIndex('reviews', 'projectId', projectId),
      DB.getAllByIndex('changeEvents', 'projectId', projectId),
      DB.get('sourceBindings', projectId)
    ]);
    if (!version?.content) return null;
    const effectiveWorkspace = workspace || {
      projectId, baseVersionId: version.versionId, textEdits: {}, selectedFragmentId: null,
      selectedSceneId: version.content.startScene, undoStack: [], redoStack: [], dirty: false,
      saveState: 'saved', updatedAt: new Date().toISOString()
    };
    return {
      project: clone(project), version: clone(version), workspace: clone(effectiveWorkspace),
      reviews: clone(reviews), changeEvents: clone(changes), binding: clone(binding),
      content: clone(version.content), effectiveContent: Domain.applyTextEditsToContent(version.content, effectiveWorkspace.textEdits || {})
    };
  }

  async saveProofreadingState(projectId, proofreading) {
    const workspace = await DB.get('workspaceDrafts', projectId);
    if (!workspace) throw new Error('Workspace проекта не найден');
    const next = { ...workspace, proofreading: clone(proofreading), updatedAt: new Date().toISOString() };
    await DB.put('workspaceDrafts', next);
    return next;
  }

  async applyTextChanges(projectId, changes, { reason = 'proofreading-edit', at = new Date().toISOString() } = {}) {
    const project = await DB.get('projects', projectId);
    if (!project) throw new Error('Проект не найден');
    const version = await DB.get('versions', project.activeVersionId);
    let workspace = await DB.get('workspaceDrafts', projectId);
    if (!version?.content || !workspace) throw new Error('Контекст проекта неполон');
    const events = [];
    for (const change of changes || []) {
      const ref = Domain.getFrameRef(version.content, change.fragmentId);
      if (!ref) continue;
      const before = Object.prototype.hasOwnProperty.call(workspace.textEdits || {}, change.fragmentId)
        ? workspace.textEdits[change.fragmentId]
        : Domain.sourceText(ref.step);
      const after = String(change.after ?? '');
      if (before === after) continue;
      workspace = Domain.recordHistory(workspace, { kind: 'text', fragmentId: change.fragmentId, before, after, label: reason });
      workspace.textEdits = { ...(workspace.textEdits || {}), [change.fragmentId]: after };
      events.push({
        eventId: `change:${crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`,
        projectId, fragmentId: change.fragmentId, kind: 'text', source: 'proofreading', reason,
        before, after, createdAt: at
      });
    }
    if (!events.length) return { workspace, events: [] };
    workspace.dirty = true;
    workspace.saveState = 'dirty';
    workspace.updatedAt = at;
    await DB.put('workspaceDrafts', workspace);
    await this.putChangeEvents(events);
    const nextProject = { ...project, updatedAt: at, lastOpenedAt: project.lastOpenedAt || at };
    await DB.put('projects', nextProject);
    return { workspace, events };
  }


  async setWorkspaceSelection(projectId, { fragmentId = null, sceneId = null } = {}) {
    const workspace = await DB.get('workspaceDrafts', projectId);
    if (!workspace) return null;
    const next = { ...workspace, selectedFragmentId: fragmentId ?? workspace.selectedFragmentId, selectedSceneId: sceneId ?? workspace.selectedSceneId, updatedAt: new Date().toISOString() };
    await DB.put('workspaceDrafts', next);
    return next;
  }

  async putChangeEvents(events) {
    if (events?.length) await DB.putMany('changeEvents', events);
  }

  async putReview(review) { await DB.put('reviews', clone(review)); return review; }
  async getReview(reviewId) { return DB.get('reviews', reviewId); }
  async updateReview(review) { await DB.put('reviews', clone(review)); return review; }
}
