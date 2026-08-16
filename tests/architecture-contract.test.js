import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const text = file => readFile(file, 'utf8');

async function filesUnder(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  }
  await walk(root);
  return out;
}

test('legacy Presentation no longer imports IndexedDB or asset infrastructure directly', async () => {
  const app = await text('heartline-app.js');
  assert.doesNotMatch(app, /from ['"]\.\/heartline-db\.js['"]/);
  assert.doesNotMatch(app, /from ['"]\.\/heartline-assets\.js['"]/);
  assert.match(app, /hl-editor\/application\/legacy-editor-gateway\.js/);
});

test('HL Presentation modules do not import Infrastructure or heartline-db directly', async () => {
  const roots = ['hl-editor/presentation', 'hl-editor/proofreading/presentation'];
  for (const root of roots) for (const file of await filesUnder(root)) {
    const source = await text(file);
    assert.doesNotMatch(source, /\/infrastructure\//, `${file} imports Infrastructure`);
    assert.doesNotMatch(source, /heartline-db\.js/, `${file} imports IndexedDB implementation`);
    assert.doesNotMatch(source, /\/bootstrap\//, `${file} imports the composition root`);
  }
});

test('only the Presentation coordinator owns MutationObserver lifecycle', async () => {
  const files = [...await filesUnder('hl-editor/presentation'), ...await filesUnder('hl-editor/proofreading/presentation')];
  const owners = [];
  for (const file of files) if ((await text(file)).includes('new MutationObserver')) owners.push(file.replaceAll('\\','/'));
  assert.deepEqual(owners, ['hl-editor/presentation/presentation-coordinator.js']);
});

test('generic parser, engine and graph contain no legacy novel route constants', async () => {
  const banned = ['CH03_SC03_EQUAL','CH03_SC03_FIRE','CH03_SC03_MASK','CH06_SC04_DIRECT','CH06_SC05_EQUAL','CH06_SC05_FIRE','CH06_SC05_MASK','ROUTE_EQUAL','ROUTE_FIRE','ROUTE_MASK','PROFESSIONAL_COST'];
  for (const file of ['heartline-parser.js','heartline-engine.js','heartline-graph-model.js']) {
    const source = await text(file);
    for (const token of banned) assert.equal(source.includes(token), false, `${file} contains ${token}`);
  }
});

test('legacy domain and DB receive parser dependencies through DI, not window globals', async () => {
  assert.equal((await text('heartline-domain.js')).includes('window.HEARTLINEParser'), false);
  assert.equal((await text('heartline-db.js')).includes('window.HEARTLINEParser'), false);
});

test('generic project config does not own a novel.json filename', async () => {
  const config = await text('hl-editor/config.js');
  assert.equal(config.includes('novel.json'), false);
  const adapterPolicy = await text('hl-editor/infrastructure/source-adapters/heartline-json-source-policy.js');
  assert.match(adapterPolicy, /novel\.json/);
});

test('composition root owns infrastructure construction', async () => {
  const root = await text('hl-editor/bootstrap/composition-root.js');
  assert.match(root, /new BrowserProjectContextRepository/);
  assert.match(root, /new ProjectService/);
  assert.match(root, /new ProofreadingService/);
});
