import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../heartline-typography.css', import.meta.url), 'utf8');

test('proofreading secondary toolbar actions are hidden', () => {
  assert.match(css, /#hlProofPending,#hlProofSearch,#hlProofQuality\{display:none!important\}/);
});

test('proofreading outline uses readable type sizes', () => {
  assert.match(css, /\.hl-proof-chapter>summary strong\{font-size:13px!important/);
  assert.match(css, /\.hl-proof-scene-head strong\{font-size:13px!important/);
  assert.match(css, /\.hl-proof-unit\{[\s\S]*?font-size:13px!important/);
});

test('proofreading editor and context stay larger than chrome', () => {
  assert.match(css, /\.hl-proof-context\{[\s\S]*?font-size:15px!important/);
  assert.match(css, /\.hl-proof-editor\{[\s\S]*?font-size:calc\(20px \* var\(--hl-proof-text-scale,1\)\)!important/);
});

test('controls and comment forms are no longer micro text', () => {
  assert.match(css, /button,input,select,textarea\{font-size:14px!important\}/);
  assert.match(css, /\.hl-proof-review-card p,.hl-proof-finding p\{font-size:13px!important/);
  assert.match(css, /\.hl-proof-form input,.hl-proof-form textarea,.hl-proof-form select\{font-size:14px!important/);
});

test('font weight policy remains capped at semibold', () => {
  const weights = [...css.matchAll(/font-weight:\s*(\d+)/g)].map(match => Number(match[1]));
  assert.ok(weights.length > 0);
  assert.ok(Math.max(...weights) <= 600);
  assert.match(css, /font-synthesis:none/);
});
