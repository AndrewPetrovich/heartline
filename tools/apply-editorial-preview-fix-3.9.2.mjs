import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const EXPECTED_VERSION = '3.9.1';
const TARGET_VERSION = '3.9.2';
const backupRoot = path.join('.git', 'heartline-update-backups', TARGET_VERSION);
const stageRoot = path.join('tools', 'editorial-preview-fix-3.9.2');

const targets = Object.freeze({
  workspaceJs: 'hl-editor/editorial/presentation/editorial-workspace.js',
  workspaceCss: 'hl-editor/editorial/presentation/editorial-workspace.css',
  packageJson: 'package.json',
  indexHtml: 'index.html',
  serviceWorker: 'sw.js'
});

const expectedHashes = Object.freeze({
  "hl-editor/editorial/presentation/editorial-workspace.js": "635e7b7465608a6743fa81882e81634767f92805bc8981ed4721a2f57d2532ef",
  "hl-editor/editorial/presentation/editorial-workspace.css": "5da5bb73f3409710ccb121d022587edd1e25d9d91c389b786c72bb52bff2dbc5"
});
const replacementHashes = Object.freeze({
  "tools/editorial-preview-fix-3.9.2/editorial-workspace.js": "28f38a983a8d9ca188e61cb2a432862db3e1d9e79ed19a3f4a40ede7643e86f1",
  "tools/editorial-preview-fix-3.9.2/editorial-workspace.css": "8de03c48413d6cc4f533d8935cecb50a81f8672691b07933d701e2717c1afcc2"
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
async function read(file) { return readFile(file, 'utf8'); }
function normalizeLf(value) { return String(value).replace(/\r\n/g, '\n'); }
function applyEol(value, eol) {
  const normalized = normalizeLf(value);
  return eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}
function replaceExact(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(before, after);
}
async function backup(file) {
  const target = path.join(backupRoot, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(file, target);
}

const packageRaw = await read(targets.packageJson);
const packageJson = JSON.parse(packageRaw);
if (packageJson.version !== EXPECTED_VERSION) {
  throw new Error(`HEARTLINE ${EXPECTED_VERSION} is required; found ${packageJson.version}`);
}

for (const [file, expected] of Object.entries(expectedHashes)) {
  const actual = sha256(await readFile(file));
  if (actual !== expected) {
    throw new Error(`${file} differs from published HEARTLINE 3.9.1 (expected ${expected}, found ${actual}). Refusing to overwrite local changes.`);
  }
}
for (const [file, expected] of Object.entries(replacementHashes)) {
  const actual = sha256(await readFile(file));
  if (actual !== expected) throw new Error(`${file} is corrupted (expected ${expected}, found ${actual})`);
}

const original = new Map();
for (const file of Object.values(targets)) original.set(file, await read(file));

const staged = new Map();
for (const [target, stagedName] of [
  [targets.workspaceJs, 'editorial-workspace.js'],
  [targets.workspaceCss, 'editorial-workspace.css']
]) {
  const before = original.get(target);
  staged.set(target, applyEol(await read(path.join(stageRoot, stagedName)), before.includes('\r\n') ? '\r\n' : '\n'));
}

packageJson.version = TARGET_VERSION;
staged.set(
  targets.packageJson,
  applyEol(JSON.stringify(packageJson, null, 2) + '\n', packageRaw.includes('\r\n') ? '\r\n' : '\n')
);

let index = normalizeLf(original.get(targets.indexHtml));
index = replaceExact(index, '<title>HEARTLINE Editor 3.9.1</title>', '<title>HEARTLINE Editor 3.9.2</title>', 'index title');
index = replaceExact(index, "window.HEARTLINE_BUILD='3.9.1-editorial-preview-fix'", "window.HEARTLINE_BUILD='3.9.2-preview-text-visualization'", 'build marker');
staged.set(targets.indexHtml, applyEol(index, original.get(targets.indexHtml).includes('\r\n') ? '\r\n' : '\n'));

let sw = normalizeLf(original.get(targets.serviceWorker));
sw = replaceExact(sw, "const CACHE='heartline-editor-3.9.1-editorial-preview-fix';", "const CACHE='heartline-editor-3.9.2-preview-text-visualization';", 'service worker cache');
staged.set(targets.serviceWorker, applyEol(sw, original.get(targets.serviceWorker).includes('\r\n') ? '\r\n' : '\n'));

for (const [file, value] of staged) {
  if (value === original.get(file)) throw new Error(`${file}: update produced no change`);
}

for (const file of staged.keys()) await backup(file);

const written = [];
try {
  for (const [file, value] of staged) {
    await writeFile(file, value, 'utf8');
    written.push(file);
  }
} catch (error) {
  for (const file of written.reverse()) {
    try { await writeFile(file, original.get(file), 'utf8'); } catch (_) {}
  }
  throw error;
}

await rm(stageRoot, { recursive: true, force: true });

console.log(`HEARTLINE ${TARGET_VERSION} Preview text visualization fix applied (${staged.size} files updated).`);
console.log('Next on Windows: npm.cmd run verify-repository && npm.cmd test && npm.cmd run check');
