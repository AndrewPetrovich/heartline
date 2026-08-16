import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile('hl-editor/editorial/presentation/editorial-workspace.js', 'utf8');
const typography = await readFile('heartline-typography.css', 'utf8');
const index = await readFile('index.html', 'utf8');

test('editorial workspace exposes the three production stages', () => {
  assert.match(workspace, /Вычитка/);
  assert.match(workspace, /Визуалы/);
  assert.match(workspace, /Финальная проверка/);
  assert.match(workspace, /data-editorial-stage/);
});

test('preview is embedded into editorial workspace and supports visual upload', () => {
  assert.match(workspace, /hlEditorialPreviewCanvas/);
  assert.match(workspace, /hlEditorialUploadVisual/);
  assert.match(workspace, /renderPlayerFrame/);
  assert.match(workspace, /Из библиотеки/);
});

test('final stage supports text editing and review creation', () => {
  assert.match(workspace, /hlEditorialEditFinalText/);
  assert.match(workspace, /hlEditorialSaveFinalText/);
  assert.match(workspace, /hlEditorialFinalReview/);
});

test('global typography is capped at semibold', () => {
  const weights = [...typography.matchAll(/font-weight\s*:\s*(\d+)/g)].map(match => Number(match[1]));
  assert.ok(weights.length >= 2);
  assert.equal(Math.max(...weights), 600);
  assert.match(typography, /font-synthesis:none/);
});

test('application shell no longer exposes standalone Preview navigation', () => {
  assert.match(index, /3\.9/);
  assert.equal(/data-route="preview"[^>]*>Превью</.test(index), false);
});
