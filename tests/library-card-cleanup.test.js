import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const js = await readFile(new URL('../hl-editor/presentation/library-card-cleanup.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../hl-editor/presentation/library-card-cleanup.css', import.meta.url), 'utf8');
const entry = await readFile(new URL('../hl-editor/index.js', import.meta.url), 'utf8');

test('library cover placeholder removes duplicated project text', () => {
  assert.match(js, /project-cover-placeholder/);
  assert.match(js, /:scope > span, :scope > strong/);
  assert.match(js, /node\.remove\(\)/);
});

test('library structure and production blocks are removed from DOM', () => {
  assert.match(js, /\.hl-project-details/);
  assert.match(js, /\.project-stats-grid/);
  assert.match(js, /\.project-production-row/);
  assert.match(js, /removeStructureAndProduction/);
});

test('css provides a defensive no-text/no-analytics fallback', () => {
  assert.match(css, /\.project-cover-placeholder>span/);
  assert.match(css, /\.project-cover-placeholder>strong/);
  assert.match(css, /\.hl-project-details/);
  assert.match(css, /display:none!important/);
});

test('cleanup is wired after the design and font policies', () => {
  const design = entry.indexOf("presentation/design-system.js");
  const font = entry.indexOf("presentation/font-policy.js");
  const cleanup = entry.indexOf("presentation/library-card-cleanup.js");
  assert.ok(design >= 0 && font > design && cleanup > font);
});

test('cleanup remains Presentation-only', () => {
  assert.doesNotMatch(js, /heartline-db|indexedDB|SourceProjectAdapter|ProjectService|repository/i);
});
