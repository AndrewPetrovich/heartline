import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultEditorialWorkflowState,
  visualFingerprint,
  deriveFinalReviewState,
  markFinalReviewed,
  aggregateEditorialStages,
  recommendedEditorialStage
} from '../hl-editor/editorial/domain/editorial-workflow.js';

test('final review is bound to both text and visual hashes', () => {
  const assignment = { assetId: 'a1', fit: 'cover', focalPoint: { x: .5, y: .4 }, zoom: 1.1, overlayOpacity: .1, deviceOverrides: {} };
  const visualHash = visualFingerprint(assignment);
  let state = createDefaultEditorialWorkflowState('2026-08-16T00:00:00Z');
  state = markFinalReviewed(state, 'f1', { textHash: 'text:1', visualHash, at: '2026-08-16T00:00:01Z' });

  const ok = deriveFinalReviewState({
    record: state.finalUnits.f1,
    textHash: 'text:1',
    visualHash,
    textReady: true,
    visualReady: true,
    openReviewCount: 0,
    diagnostics: [{ warnings: [] }]
  });
  assert.equal(ok.status, 'reviewed');

  const textChanged = deriveFinalReviewState({
    record: state.finalUnits.f1,
    textHash: 'text:2',
    visualHash,
    textReady: true,
    visualReady: true,
    openReviewCount: 0,
    diagnostics: [{ warnings: [] }]
  });
  assert.equal(textChanged.status, 'changed');

  const visualChanged = deriveFinalReviewState({
    record: state.finalUnits.f1,
    textHash: 'text:1',
    visualHash: visualFingerprint({ ...assignment, zoom: 1.3 }),
    textReady: true,
    visualReady: true,
    openReviewCount: 0,
    diagnostics: [{ warnings: [] }]
  });
  assert.equal(visualChanged.status, 'changed');
});

test('final review is attention when workflow prerequisites are incomplete', () => {
  const result = deriveFinalReviewState({
    record: null,
    textHash: 't',
    visualHash: 'v',
    textReady: false,
    visualReady: false,
    openReviewCount: 2,
    diagnostics: [{ warnings: [{ level: 'error', code: 'overflow' }] }]
  });
  assert.equal(result.status, 'attention');
  assert.deepEqual(result.blockers.map(item => item.code), ['text-not-reviewed', 'missing-visual', 'open-reviews', 'preview-errors']);
});

test('workflow aggregates the three editorial stages independently', () => {
  const stages = aggregateEditorialStages([
    { textStatus: 'reviewed', visualReady: true, finalStatus: 'reviewed' },
    { textStatus: 'reviewed', visualReady: false, finalStatus: 'attention' },
    { textStatus: 'changed', visualReady: true, finalStatus: 'changed' },
    { textStatus: 'not-started', visualReady: false, finalStatus: 'not-started' }
  ]);
  assert.equal(stages.text.percent, 50);
  assert.equal(stages.visual.percent, 50);
  assert.equal(stages.final.percent, 25);
  assert.equal(stages.final.attention, 1);
  assert.equal(stages.final.changed, 1);
  assert.equal(recommendedEditorialStage(stages), 'text');
});
