import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['.git', 'node_modules', '.hl-editor']);
const extensions = new Set(['.js', '.mjs']);
const files = [];

async function walk(relative = '.') {
  const absolute = path.resolve(ROOT, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      await walk(child);
      continue;
    }
    if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(child);
  }
}

await walk('.');
files.sort((a, b) => a.localeCompare(b));

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`Syntax check failed: ${file}`);
  }
}

if (failed) {
  console.error(`JavaScript syntax check: FAIL (${failed}/${files.length})`);
  process.exit(1);
}

console.log(`JavaScript syntax check: PASS (${files.length} files)`);
