import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile('hl-editor/editorial/presentation/editorial-workspace.js', 'utf8');
const css = await readFile('hl-editor/editorial/presentation/editorial-workspace.css', 'utf8');

test('Preview supports frames without an assigned image', () => {
  assert.match(workspace, /unit\.assetId \? await workflowService\.assetObjectUrl\(unit\.assetId\) : null/);
  assert.match(workspace, /renderPlayerFrame\(host/);
  assert.match(workspace, /data\.renderState|dataset\.renderState/);
});

test('Preview render is deferred and protected from stale async renders', () => {
  assert.match(workspace, /previewRenderGeneration/);
  assert.match(workspace, /async function nextPaint/);
  assert.match(workspace, /currentUnit\(\)\?\.fragmentId !== unit\.fragmentId/);
});

test('Preview failures are visible in the canvas instead of leaving it blank', () => {
  assert.match(workspace, /function renderPreviewFailure/);
  assert.match(workspace, /Preview временно недоступен/);
  assert.match(workspace, /hlEditorialRetryPreview/);
});

test('final text editing lives in the central Preview workspace', () => {
  assert.match(workspace, /hl-editorial-final-center-edit/);
  assert.match(workspace, /id="hlEditorialFinalEditor"/);
  assert.match(workspace, /id="hlEditorialEditCaption"/);
  assert.doesNotMatch(workspace, /hl-editorial-final-edit"><textarea id="hlEditorialFinalEditor"/);
});

test('final text is flushed before changing fragment or stage', () => {
  assert.match(workspace, /async function flushPendingFinalText/);
  assert.match(workspace, /fragmentId !== selectedFragmentId\) await flushPendingFinalText/);
  assert.match(workspace, /await flushPendingFinalText\(\);\n  stage = nextStage/);
});

test('toast is moved away from the bottom caption', () => {
  assert.match(css, /\.hl-editorial-toast\{[\s\S]*top:calc\(var\(--header-h\) \+ 76px\)!important/);
  assert.match(css, /bottom:auto!important/);
});


test('final text editor has debounce autosave and leave protection', () => {
  assert.match(workspace, /function scheduleFinalTextDraftSave/);
  assert.match(workspace, /editorial-final-autosave/);
  assert.match(workspace, /editorial-final-leave/);
  assert.match(workspace, /addEventListener\('input', scheduleFinalTextDraftSave\)/);
});
