import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile('hl-editor/proofreading/presentation/proofreading-workspace.js', 'utf8');
const typography = await readFile('heartline-typography.css', 'utf8');
const index = await readFile('index.html', 'utf8');

test('proofreading keeps one contextual right pane without Checks/Dictionary tabs', () => {
  assert.equal(workspace.includes('data-proof-tab="quality"'), false);
  assert.equal(workspace.includes('data-proof-tab="dictionary"'), false);
  assert.match(workspace, /hl-proof-right-head/);
  assert.match(workspace, /rightTitleLabel/);
});

test('standalone check-text action is removed from the editor', () => {
  assert.equal(workspace.includes('id="hlProofRunChecks"'), false);
  assert.match(workspace, /hlProofRefreshFindings/);
});

test('global typography is capped at semibold', () => {
  const weights = [...typography.matchAll(/font-weight\s*:\s*(\d+)/g)].map(match => Number(match[1]));
  assert.ok(weights.length >= 2);
  assert.equal(Math.max(...weights), 600);
  assert.match(typography, /html body \*/);
  assert.match(typography, /font-synthesis:none/);
});

test('typography cap is loaded by the application shell', () => {
  assert.match(index, /heartline-typography\.css/);
  assert.match(index, /3\.5\.2/);
});
