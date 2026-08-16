import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const errors = [];
const read = file => readFile(file, 'utf8');
async function filesUnder(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  }
  await walk(root); return out;
}
function fail(message) { errors.push(message); }

const app = await read('heartline-app.js');
if (/from ['"]\.\/heartline-db\.js['"]/.test(app)) fail('heartline-app.js imports heartline-db.js directly');
if (/from ['"]\.\/heartline-assets\.js['"]/.test(app)) fail('heartline-app.js imports heartline-assets.js directly');

const presentationFiles = [...await filesUnder('hl-editor/presentation'), ...await filesUnder('hl-editor/proofreading/presentation')];
const observerOwners = [];
for (const file of presentationFiles) {
  const source = await read(file);
  if (/\/infrastructure\//.test(source)) fail(`${file}: Presentation imports Infrastructure`);
  if (/heartline-db\.js/.test(source)) fail(`${file}: Presentation imports IndexedDB directly`);
  if (/\/bootstrap\//.test(source)) fail(`${file}: Presentation imports composition root directly`);
  if (source.includes('new MutationObserver')) observerOwners.push(file.replaceAll('\\','/'));
}
if (observerOwners.length !== 1 || observerOwners[0] !== 'hl-editor/presentation/presentation-coordinator.js') fail(`MutationObserver ownership must be singular; found: ${observerOwners.join(', ')}`);

const banned = ['CH03_SC03_EQUAL','CH03_SC03_FIRE','CH03_SC03_MASK','CH06_SC04_DIRECT','CH06_SC05_EQUAL','CH06_SC05_FIRE','CH06_SC05_MASK','ROUTE_EQUAL','ROUTE_FIRE','ROUTE_MASK','PROFESSIONAL_COST'];
for (const file of ['heartline-parser.js','heartline-engine.js','heartline-graph-model.js']) {
  const source = await read(file);
  for (const token of banned) if (source.includes(token)) fail(`${file}: novel-specific hardcode ${token}`);
}
if ((await read('heartline-domain.js')).includes('window.HEARTLINEParser')) fail('heartline-domain.js reads parser from window');
if ((await read('heartline-db.js')).includes('window.HEARTLINEParser')) fail('heartline-db.js reads parser from window');
if ((await read('hl-editor/config.js')).includes('novel.json')) fail('hl-editor/config.js owns adapter-specific novel.json filename');

if (errors.length) {
  console.error('Architecture policy: FAIL\n' + errors.map(item => ` - ${item}`).join('\n'));
  process.exit(1);
}
console.log('Architecture policy: PASS');
