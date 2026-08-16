import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile('hl-editor/editorial/presentation/editorial-workspace.js', 'utf8');
const css = await readFile('hl-editor/editorial/presentation/editorial-workspace.css', 'utf8');

test('no-image final Preview renders a synchronous phone shell', () => {
  assert.match(workspace, /function renderImmediatePreviewShell/);
  assert.match(workspace, /renderPlayerFrame\(host/);
  assert.match(workspace, /assetUrl:\s*null/);
  assert.match(workspace, /if \(!unit\.assetId\)/);
  assert.match(workspace, /renderImmediatePreviewShell\(\);\n\s*host\.dataset\.renderState = 'placeholder'/);
});

test('Preview shell is created before workspace event binding', () => {
  const shell = workspace.indexOf('renderImmediatePreviewShell();');
  const bind = workspace.indexOf('bindWorkspace();', shell);
  assert.ok(shell >= 0 && bind > shell);
});

test('mobile Preview frame always receives the current text', () => {
  assert.match(workspace, /function previewFrameFromUnit\(unit\)/);
  assert.match(workspace, /text:\s*unit\.text/);
  assert.match(workspace, /speaker:\s*unit\.speaker/);
});

test('compact NICO/text/Edit caption is kept while editor is open', () => {
  assert.match(workspace, /\$\{caption\}\s*\n\s*\$\{finalEditor\}/);
  assert.match(workspace, /id="hlEditorialEditCaption"/);
  assert.match(workspace, /hlEditorialFinalEditor/);
});

test('final editor stacks below the persistent compact caption', () => {
  assert.match(css, /\.hl-editorial-preview-center\.editing-text\{[\s\S]*grid-template-rows:auto minmax\(0,1fr\) auto auto/);
});

test('rendered player cannot be hidden by editorial Preview state styles', () => {
  assert.match(css, /\.hl-editorial-preview-canvas \.player-device\{[\s\S]*visibility:visible!important/);
  assert.match(css, /opacity:1!important/);
});
