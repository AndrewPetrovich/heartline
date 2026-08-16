import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = file => readFile(file, 'utf8');

test('editorial Presentation depends on Application services, not Infrastructure or DB', async () => {
  const source = await text('hl-editor/editorial/presentation/editorial-workspace.js');
  assert.match(source, /application\/service-container\.js/);
  assert.doesNotMatch(source, /\/infrastructure\//);
  assert.doesNotMatch(source, /heartline-db\.js/);
  assert.doesNotMatch(source, /new MutationObserver/);
});

test('editorial Application depends on ports and proofreading service, not DOM', async () => {
  const source = await text('hl-editor/editorial/application/editorial-workflow-service.js');
  assert.match(source, /ports\/editorial-workflow-repository\.js/);
  assert.match(source, /ports\/visual-asset-gateway\.js/);
  assert.doesNotMatch(source, /document\.|window\./);
  assert.doesNotMatch(source, /\/infrastructure\//);
});

test('final review stores both textHash and visualHash', async () => {
  const source = await text('hl-editor/editorial/domain/editorial-workflow.js');
  assert.match(source, /textHash/);
  assert.match(source, /visualHash/);
  assert.match(source, /markFinalReviewed/);
});

test('three-stage pipeline is modeled in Domain', async () => {
  const source = await text('hl-editor/editorial/domain/editorial-workflow.js');
  assert.match(source, /\['text', 'visual', 'final'\]/);
  assert.match(source, /aggregateEditorialStages/);
  assert.match(source, /recommendedEditorialStage/);
});

test('standalone legacy proofreading Presentation is not the composition entry anymore', async () => {
  const source = await text('hl-editor/index.js');
  assert.match(source, /editorial\/presentation\/editorial-workspace\.js/);
  assert.doesNotMatch(source, /proofreading\/presentation\/proofreading-workspace\.js/);
});
