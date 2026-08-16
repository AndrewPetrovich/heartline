import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorialWorkflowService } from '../hl-editor/editorial/application/editorial-workflow-service.js';

class FakeRepository {
  constructor() {
    this.editorial = null;
    this.selection = null;
    this.bundle = {
      project: { projectId: 'p1', title: 'Mini Novel', activeVersionId: 'v1' },
      workspace: { projectId: 'p1', textEdits: {}, dirty: false, saveState: 'saved', editorialWorkflow: null },
      reviews: [],
      assignments: [],
      assets: [],
      content: { scenes: [] }
    };
  }
  async getProjectBundle() {
    return {
      ...this.bundle,
      workspace: { ...this.bundle.workspace, editorialWorkflow: this.editorial }
    };
  }
  async saveEditorialState(_projectId, state) { this.editorial = structuredClone(state); }
  async setWorkspaceSelection(_projectId, selection) { this.selection = selection; }
}

class FakeProofreading {
  constructor() {
    this.marked = new Set();
  }
  async getActiveProjectId() { return 'p1'; }
  async load() {
    const textStatus = this.marked.has('f1') ? 'reviewed' : 'not-started';
    const units = [
      {
        fragmentId: 'f1', sceneId: 's1', sceneTitle: 'Scene 1', chapterId: 'c1', chapterTitle: 'Chapter 1',
        type: 'dialogue', speaker: 'A', text: 'Hello', options: [], status: textStatus,
        currentHash: textStatus === 'reviewed' ? 'hash:hello' : 'hash:hello', reviews: [], openReviewCount: 0
      }
    ];
    return {
      project: { projectId: 'p1', title: 'Mini Novel', activeVersionId: 'v1' },
      workspace: { projectId: 'p1', selectedFragmentId: 'f1', dirty: false, saveState: 'saved' },
      units,
      scenes: [{ sceneId: 's1', title: 'Scene 1', chapterId: 'c1', chapterTitle: 'Chapter 1', units, progress: { percent: textStatus === 'reviewed' ? 100 : 0 } }],
      chapters: [{ chapterId: 'c1', title: 'Chapter 1', units, scenes: [], progress: { percent: textStatus === 'reviewed' ? 100 : 0 } }],
      progress: { total: 1, completed: textStatus === 'reviewed' ? 1 : 0, percent: textStatus === 'reviewed' ? 100 : 0, counts: {} },
      categories: ['Другое'],
      reviewWorkflowStates: ['open', 'resolved']
    };
  }
  async markUnit(_projectId, fragmentId) { this.marked.add(fragmentId); }
  async saveText() { return { changed: true }; }
  async createReview() {}
  async updateReviewWorkflow() {}
}

class FakeVisualGateway {
  constructor(repo) { this.repo = repo; }
  async importAndAssign(_projectId, fragmentId) {
    const asset = { assetId: 'asset1', name: 'image.png', width: 1200, height: 1800 };
    const assignment = { fragmentId, assetId: asset.assetId, fit: 'cover', focalPoint: { x: .5, y: .5 }, zoom: 1, overlayOpacity: .1, deviceOverrides: {} };
    this.repo.bundle.assignments = [assignment];
    this.repo.bundle.assets = [asset];
    return { asset, assignment };
  }
  async assignExisting(_projectId, fragmentId, assetId) {
    const assignment = { fragmentId, assetId, fit: 'cover', focalPoint: { x: .5, y: .5 }, zoom: 1, overlayOpacity: .1, deviceOverrides: {} };
    this.repo.bundle.assignments = [assignment];
    return assignment;
  }
  async updateAssignment(_projectId, fragmentId, patch) {
    const current = this.repo.bundle.assignments.find(item => item.fragmentId === fragmentId) || { fragmentId };
    const next = { ...current, ...patch };
    this.repo.bundle.assignments = [next];
    return next;
  }
  async removeAssignment() { this.repo.bundle.assignments = []; }
  async assetObjectUrl() { return 'blob:test'; }
}

const deviceService = {
  comparisonPreset() { return [{ id: 'phone', label: 'Phone' }]; },
  defaultProfile() { return { id: 'phone', label: 'Phone' }; },
  normalizeComparison(ids) { return [...new Set(ids)]; },
  resolve(id) { return { id, label: id }; }
};

function createEnv({ diagnostics = [] } = {}) {
  const repo = new FakeRepository();
  const proofreading = new FakeProofreading();
  const visual = new FakeVisualGateway(repo);
  const service = new EditorialWorkflowService({
    repository: repo,
    proofreadingService: proofreading,
    visualGateway: visual,
    deviceProfileService: deviceService,
    diagnoseFrame: () => ({ warnings: diagnostics, ok: !diagnostics.some(item => item.level === 'error') }),
    clock: (() => { let n = 0; return () => `2026-08-16T00:00:0${n++}Z`; })()
  });
  return { repo, proofreading, visual, service };
}

test('visual stage is driven by actual workspace assignment', async () => {
  const env = createEnv();
  let model = await env.service.load('p1');
  assert.equal(model.stages.visual.percent, 0);
  await env.service.importVisual('p1', 'f1', {});
  model = await env.service.load('p1');
  assert.equal(model.stages.visual.percent, 100);
  assert.equal(model.units[0].visualReady, true);
});

test('final completion can confirm clean current text and then bind final hashes', async () => {
  const env = createEnv();
  await env.service.importVisual('p1', 'f1', {});
  const result = await env.service.completeFinal('p1', 'f1');
  assert.equal(result.completed, true);
  assert.equal(env.proofreading.marked.has('f1'), true);
  const model = await env.service.load('p1');
  assert.equal(model.stages.text.percent, 100);
  assert.equal(model.stages.final.percent, 100);
});

test('critical preview error keeps final unit open', async () => {
  const env = createEnv({ diagnostics: [{ code: 'overflow', level: 'error', text: 'overflow' }] });
  await env.service.importVisual('p1', 'f1', {});
  const result = await env.service.completeFinal('p1', 'f1');
  assert.equal(result.completed, false);
  assert.equal(result.blockers.some(item => item.code === 'preview-errors'), true);
});

test('changing visual settings invalidates previous final completion', async () => {
  const env = createEnv();
  await env.service.importVisual('p1', 'f1', {});
  await env.service.completeFinal('p1', 'f1');
  let model = await env.service.load('p1');
  assert.equal(model.units[0].finalStatus, 'reviewed');

  await env.service.updateVisual('p1', 'f1', { zoom: 1.4 });
  model = await env.service.load('p1');
  assert.equal(model.units[0].finalStatus, 'changed');
});
