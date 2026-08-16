import * as DB from '../../../heartline-db.js';
import * as Domain from '../../../heartline-domain.js';

const clone = value => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));

function assetMeta(asset) {
  if (!asset) return null;
  const { blob, ...rest } = asset;
  return clone(rest);
}

export class BrowserEditorialWorkflowRepository {
  async getProjectBundle(projectId) {
    const project = await DB.get('projects', projectId);
    if (!project) return null;
    const [version, workspace, reviews, binding, assignments, assets] = await Promise.all([
      DB.get('versions', project.activeVersionId),
      DB.get('workspaceDrafts', projectId),
      DB.getAllByIndex('reviews', 'projectId', projectId),
      DB.get('sourceBindings', projectId),
      DB.getAllByIndex('visualAssignments', 'scopeId', DB.workspaceScope(projectId)),
      DB.getAllByIndex('assets', 'projectId', projectId)
    ]);
    if (!version?.content) return null;
    const effectiveWorkspace = workspace || {
      projectId,
      baseVersionId: version.versionId,
      textEdits: {},
      selectedFragmentId: null,
      selectedSceneId: version.content.startScene,
      undoStack: [],
      redoStack: [],
      dirty: false,
      saveState: 'saved',
      updatedAt: new Date().toISOString()
    };
    return {
      project: clone(project),
      version: clone(version),
      workspace: clone(effectiveWorkspace),
      reviews: clone(reviews),
      binding: clone(binding),
      assignments: clone(assignments),
      assets: assets.map(assetMeta),
      content: clone(version.content),
      effectiveContent: Domain.applyTextEditsToContent(version.content, effectiveWorkspace.textEdits || {})
    };
  }

  async saveEditorialState(projectId, editorialWorkflow) {
    const workspace = await DB.get('workspaceDrafts', projectId);
    if (!workspace) throw new Error('Workspace проекта не найден');
    const next = {
      ...workspace,
      editorialWorkflow: clone(editorialWorkflow),
      updatedAt: new Date().toISOString()
    };
    await DB.put('workspaceDrafts', next);
    return next;
  }

  async setWorkspaceSelection(projectId, { fragmentId = null, sceneId = null } = {}) {
    const workspace = await DB.get('workspaceDrafts', projectId);
    if (!workspace) return null;
    const next = {
      ...workspace,
      selectedFragmentId: fragmentId ?? workspace.selectedFragmentId,
      selectedSceneId: sceneId ?? workspace.selectedSceneId,
      updatedAt: new Date().toISOString()
    };
    await DB.put('workspaceDrafts', next);
    return next;
  }
}
