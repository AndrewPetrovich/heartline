import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const js = await readFile(new URL('../hl-editor/presentation/library-card-cleanup.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../hl-editor/presentation/library-card-cleanup.css', import.meta.url), 'utf8');

test('readiness panel is explicitly restored', () => {
  assert.match(js, /function createReadinessPanel/);
  assert.match(js, /Готовность вычитки/);
  assert.match(js, /hl-project-proofreading/);
});

test('readiness uses the existing ProofreadingService model', () => {
  assert.match(js, /window\.HEARTLINEProofreading\?\.service/);
  assert.match(js, /await service\.load\(projectId\)/);
  assert.match(js, /model\?\.progress/);
});

test('restored panel contains the requested editorial metrics', () => {
  assert.match(js, /осталось/);
  assert.match(js, /замечаний/);
  assert.match(js, /изменено/);
  assert.match(js, /Последняя позиция/);
  assert.match(js, /фрагментов проверено/);
});

test('structure and production remain removed', () => {
  assert.match(js, /removeStructureAndProduction/);
  assert.match(js, /\.hl-project-details/);
  assert.match(js, /\.project-stats-grid/);
  assert.match(js, /\.project-production-row/);
});

test('readiness insertion is race-safe and non-duplicating', () => {
  assert.match(js, /hlReadinessPending/);
  assert.match(js, /card\.querySelector\('\.hl-project-proofreading'\)/);
  assert.match(js, /insertBefore\(panel, footer\)/);
});

test('css guarantees readiness panel is visible', () => {
  assert.match(css, /\.hl-project-proofreading\{\s*display:block!important/);
});
