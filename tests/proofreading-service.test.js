import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofreadingService } from '../hl-editor/proofreading/application/proofreading-service.js';

function novel() {
  return {
    title: 'Test', startScene: 'S1', storyMetadata: { reviewRoutes: [
      { id: 'R1', name: 'Route 1', sceneIds: ['S1', 'S2'] },
      { id: 'R2', name: 'Route 2', sceneIds: ['S1', 'S3'] }
    ] },
    scenes: [
      { id: 'S1', title: 'Shared', chapterId: 'C1', chapterTitle: 'Глава 1', order: 0, steps: [{ type: 'narration', fragmentId: 'f1', text: 'Общий текст.' }] },
      { id: 'S2', title: 'A', chapterId: 'C1', chapterTitle: 'Глава 1', order: 1, steps: [{ type: 'dialogue', fragmentId: 'f2', speaker: 'А', text: 'Ветка A.' }] },
      { id: 'S3', title: 'B', chapterId: 'C2', chapterTitle: 'Глава 2', order: 2, steps: [{ type: 'dialogue', fragmentId: 'f3', speaker: 'Б', text: 'Ветка B.' }] }
    ]
  };
}

class MemoryRepo {
  constructor() {
    this.project = { projectId: 'p1', title: 'Test', activeVersionId: 'v1', sourceBacked: true, updatedAt: '2026-08-15T00:00:00Z' };
    this.version = { versionId: 'v1', content: novel() };
    this.workspace = { projectId: 'p1', baseVersionId: 'v1', textEdits: {}, dirty: false, saveState: 'saved', proofreading: null };
    this.reviews = [];
    this.events = [];
    this.visualAssignments = [{ fragmentId: 'f1', status: 'approved' }];
  }
  async getMostRecentProject() { return this.project; }
  async getProjectBundle() { return { project: structuredClone(this.project), version: structuredClone(this.version), workspace: structuredClone(this.workspace), reviews: structuredClone(this.reviews), changeEvents: structuredClone(this.events), binding: { projectId: 'p1' }, content: structuredClone(this.version.content), effectiveContent: structuredClone(this.version.content) }; }
  async saveProofreadingState(_id, state) { this.workspace.proofreading = structuredClone(state); return this.workspace; }
  async applyTextChanges(_id, changes, { reason, at }) { const events=[]; for (const change of changes) { const before = this.workspace.textEdits[change.fragmentId] ?? ({f1:'Общий текст.',f2:'Ветка A.',f3:'Ветка B.'}[change.fragmentId]); if(before===change.after) continue; this.workspace.textEdits[change.fragmentId]=change.after; events.push({eventId:`e${this.events.length+events.length}`,projectId:'p1',fragmentId:change.fragmentId,before,after:change.after,reason,createdAt:at}); } this.workspace.dirty=events.length>0; this.workspace.saveState=events.length?'dirty':this.workspace.saveState; this.events.push(...events); return {workspace:this.workspace,events}; }
  async putChangeEvents(events) { this.events.push(...events.filter(event => !this.events.some(existing => existing.eventId === event.eventId))); }
  async putReview(review) { this.reviews.push(structuredClone(review)); return review; }
  async getReview(id) { return structuredClone(this.reviews.find(item => item.reviewId === id)); }
  async updateReview(review) { const i=this.reviews.findIndex(item=>item.reviewId===review.reviewId); this.reviews[i]=structuredClone(review); return review; }
  async setWorkspaceSelection() { return this.workspace; }
}

function makeService(repo, projectCalls = []) {
  let n=0;
  return new ProofreadingService({ repository: repo, projectService: {
    async createManualRevision(projectId, options){ projectCalls.push(['revision',projectId,options]); return {status:'created'}; },
    async markProjectReviewed(projectId, options){ projectCalls.push(['project-review',projectId,options]); return {status:options.approved?'approved':'reviewed'}; }
  }, uuid:()=>`u${++n}`, clock:()=>`2026-08-15T00:00:0${Math.min(n,9)}Z` });
}

test('workspace model reports progress per chapter and shared review route', async () => {
  const repo=new MemoryRepo(); const service=makeService(repo);
  let model=await service.load('p1');
  assert.equal(model.chapters.length,2);
  await service.markUnit('p1','f1');
  model=await service.load('p1');
  assert.equal(model.chapters[0].progress.percent,50);
  assert.equal(model.routeCoverage.routes.length,2);
  assert.equal(model.routeCoverage.routes[0].completed,1);
  assert.equal(model.routeCoverage.routes[1].completed,1);
});

test('open review blocks marking a fragment reviewed', async () => {
  const repo=new MemoryRepo(); const service=makeService(repo);
  await service.createReview('p1',{fragmentId:'f1',comment:'Проверить',startOffset:0,endOffset:5});
  await assert.rejects(()=>service.markUnit('p1','f1'),/открытых замечаний/);
});

test('new review stores durable offsets and simplified workflow status', async () => {
  const repo=new MemoryRepo(); const service=makeService(repo);
  const review=await service.createReview('p1',{fragmentId:'f1',category:'Стиль',comment:'Слишком сухо',startOffset:0,endOffset:5});
  assert.equal(review.textAnchor.startOffset,0);
  assert.equal(review.textAnchor.quotedText,'Общий');
  assert.equal(review.workflowStatus,'open');
  await service.updateReviewWorkflow(review.reviewId,'resolved');
  assert.equal(repo.reviews[0].status,'Принято');
});

test('proofreading edit does not invalidate approved visual assignment', async () => {
  const repo=new MemoryRepo(); const service=makeService(repo);
  await service.saveText('p1','f1','Исправленный общий текст.');
  assert.equal(repo.visualAssignments[0].status,'approved');
  const model=await service.load('p1');
  assert.equal(model.units.find(unit=>unit.fragmentId==='f1').text,'Исправленный общий текст.');
});

test('bulk search replace creates safety revision and leaves reviewed unit changed', async () => {
  const repo=new MemoryRepo(); const calls=[]; const service=makeService(repo,calls);
  await service.markUnit('p1','f1');
  let model=await service.load('p1');
  const preview=service.search(model,{query:'Общий',replacement:'Новый'});
  assert.equal(preview.matchCount,1);
  const result=await service.commitReplace('p1',preview);
  assert.equal(result.changedFragments,1);
  assert.equal(calls[0][0],'revision');
  model=await service.load('p1');
  assert.equal(model.units.find(unit=>unit.fragmentId==='f1').status,'changed');
});

test('scene completion skips fragments with unresolved reviews', async () => {
  const repo=new MemoryRepo(); const service=makeService(repo);
  await service.createReview('p1',{fragmentId:'f2',comment:'Open'});
  const result=await service.markScope('p1',{sceneId:'S2'});
  assert.deepEqual(result.skipped,['f2']);
  assert.equal(result.completed,0);
});

test('final book approval calls hash-bound project review after granular completion', async () => {
  const repo=new MemoryRepo(); const calls=[]; const service=makeService(repo,calls);
  await service.selectPass('p1','final');
  const result=await service.markProject('p1',{passId:'final',approved:true});
  assert.equal(result.skipped.length,0);
  assert.ok(calls.some(call=>call[0]==='project-review'));
});

test('legacy quoted review gets upgraded when quote is unique', async () => {
  const repo=new MemoryRepo(); repo.reviews.push({reviewId:'legacy',projectId:'p1',versionId:'v1',targetType:'text',fragmentId:'f1',quotedText:'Общий',comment:'legacy',status:'Открыто'});
  const service=makeService(repo);
  const count=await service.upgradeLegacyAnchors('p1');
  assert.equal(count,1);
  assert.equal(repo.reviews[0].textAnchor.quotedText,'Общий');
});
