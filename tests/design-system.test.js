import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const js = await readFile(new URL('../hl-editor/presentation/design-system.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../hl-editor/presentation/design-system.css', import.meta.url), 'utf8');
const entry = await readFile(new URL('../hl-editor/index.js', import.meta.url), 'utf8');

test('design system is wired through presentation entry point', () => {
  assert.match(entry, /presentation\/design-system\.js/);
});

test('design system stays in presentation and does not import persistence infrastructure', () => {
  assert.doesNotMatch(js, /from ['"]\.\.\/.*(?:db|infrastructure|repository)/i);
  assert.doesNotMatch(js, /heartline-db\.js/);
});

test('action callout has one clear primary CTA visual language', () => {
  assert.match(css, /--hl-ds-accent:#0969da/);
  assert.match(css, /\.hl-action-callout\{/);
  assert.match(css, /\.hl-action-callout-button\.primary\{/);
});

test('library, storyboard, graph, reviews, export and versions have dedicated UX enhancers', () => {
  for (const name of ['enhanceLibrary','enhanceStoryboard','enhanceGraph','enhanceReviews','enhanceExport','enhanceVersions']) {
    assert.match(js, new RegExp(`function ${name}\\(`));
  }
});

test('graph advanced controls are progressively disclosed', () => {
  assert.match(js, /createDisclosure\('Настройки вида'/);
  assert.match(js, /movable\.forEach\(node => body\.appendChild\(node\)\)/);
});

test('storyboard card actions are hidden until engagement on desktop', () => {
  assert.match(css, /\.frame-card\.hl-ds-hover-card \.frame-card-actions\{opacity:0/);
  assert.match(css, /hover \.frame-card-actions/);
});


test('proofreading chrome removes persistent technical fragment id and topbar utilities are contextual', () => {
  assert.match(js, /const meta = shell\.querySelector\('\.hl-proof-editor-head p'\)/);
  assert.match(js, /hl-ds-context-hidden/);
});

test('design system never exceeds semibold weight', () => {
  const weights = [...css.matchAll(/font-weight:\s*(\d+)/g)].map(match => Number(match[1]));
  assert.ok(weights.every(weight => weight <= 600));
});

test('proofreading persistent onboarding callout is removed', () => {
  assert.doesNotMatch(js, /title:\s*'Есть проблема с фрагментом\?'/);
  assert.match(js, /hl-proof-review-onboarding'\)\.forEach\(node => node\.remove\(\)\)/);
});

test('library cards are proofreading-first and use the proofreading service model', () => {
  assert.match(js, /function proofreadingCardPresentation\(model\)/);
  assert.match(js, /createProjectProofreadingPanel\(model\)/);
  assert.match(js, /Готовность вычитки/);
  assert.match(js, /openReviews/);
  assert.match(js, /changed/);
  assert.match(js, /Последняя позиция/);
  assert.match(css, /\.hl-project-proofreading\{/);
  assert.match(css, /\.hl-project-proofreading-percent\{font-size:30px!important/);
});

test('desktop library cards no longer use the four-column micro-card layout', () => {
  assert.match(css, /grid-template-columns:repeat\(auto-fill,minmax\(360px,420px\)\)!important/);
  assert.match(css, /\.library-page \.project-card-rich-head h2\{font-size:22px!important/);
  assert.match(css, /\.library-page \.project-card-rich-foot \.button\{min-height:40px!important/);
});
