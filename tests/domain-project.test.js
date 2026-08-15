import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProjectContext, ensureStableFragmentIds, reviewStateForCurrentHash,
  markReviewed, classifySourceChange
} from '../hl-editor/domain/project.js';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
];

test('project context requires stable UUID identity', () => {
  const context = createProjectContext({
    projectId: ids[0], documentId: ids[1], title: 'Novel', sourcePath: 'novel.json', sourceHash: 'abc', now: '2026-08-15T00:00:00Z'
  });
  assert.equal(context.projectId, ids[0]);
  assert.equal(context.documents[0].documentId, ids[1]);
  assert.throws(() => createProjectContext({ projectId: 'slug-1', documentId: ids[1], title: 'x', sourcePath: 'novel.json', sourceHash: 'x', now: 'x' }));
});

test('missing fragment identities become UUID-backed and survive reorder', () => {
  let index = 0;
  const novel = { scenes: [{ id: 'S1', steps: [{ type: 'narration', text: 'A' }, { type: 'narration', text: 'B' }] }] };
  ensureStableFragmentIds(novel, () => ids[index++]);
  const first = novel.scenes[0].steps.map(step => step.fragmentId);
  novel.scenes[0].steps.reverse();
  ensureStableFragmentIds(novel, () => ids[index++]);
  assert.deepEqual(novel.scenes[0].steps.map(step => step.fragmentId), first.reverse());
});

test('review is invalidated when source hash changes', () => {
  const reviewed = markReviewed('hash-a', '2026-08-15T00:00:00Z', true);
  assert.equal(reviewStateForCurrentHash(reviewed, 'hash-a').status, 'approved');
  assert.equal(reviewStateForCurrentHash(reviewed, 'hash-b').status, 'in-progress');
});

test('source scan distinguishes unchanged moved modified deleted', () => {
  assert.equal(classifySourceChange({ expectedHash: 'a', actualHash: 'a', previousPath: 'a.json', currentPath: 'a.json' }), 'unchanged');
  assert.equal(classifySourceChange({ expectedHash: 'a', actualHash: 'a', previousPath: 'a.json', currentPath: 'b.json' }), 'moved');
  assert.equal(classifySourceChange({ expectedHash: 'a', actualHash: 'b', previousPath: 'a.json', currentPath: 'a.json' }), 'modified');
  assert.equal(classifySourceChange({ expectedHash: 'a', actualHash: null, previousPath: 'a.json', currentPath: 'a.json' }), 'deleted');
});
