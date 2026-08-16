import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../hl-editor/presentation/font-policy.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../hl-editor/presentation/font-policy.js', import.meta.url), 'utf8');
const entry = await readFile(new URL('../hl-editor/index.js', import.meta.url), 'utf8');

test('unified font policy uses the application sans-serif stack', () => {
  assert.match(css, /--hl-ui-font:/);
  assert.match(css, /"Segoe UI"/);
  assert.match(css, /Roboto/);
  assert.match(css, /Arial/);
  assert.match(css, /sans-serif/);
});

test('legacy literary surfaces cannot apply serif families', () => {
  for (const selector of [
    '.project-cover-placeholder strong',
    '.context-frame',
    '.current-frame .frame-text',
    '.frame-card-text',
    '.hl-proof-context',
    '.hl-proof-editor',
    '.hl-proof-quote'
  ]) {
    assert.ok(css.includes(selector), `missing selector ${selector}`);
  }
  assert.match(css, /font-family:var\(--hl-ui-font\)!important/);
});

test('technical code surfaces are excluded from the universal inheritance override', () => {
  assert.match(css, /:not\(code\):not\(pre\):not\(kbd\):not\(samp\)/);
});

test('proofreading serif control is retired and preference normalizes to sans', () => {
  assert.match(js, /#hlProofFont/);
  assert.match(js, /font:\s*'sans'/);
  assert.match(js, /hl-proof-font-sans/);
});

test('font policy is part of the editor composition root', () => {
  assert.match(entry, /presentation\/font-policy\.js/);
});
