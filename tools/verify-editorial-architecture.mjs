import { readFile, access } from 'node:fs/promises';

const required = [
  'hl-editor/editorial/domain/editorial-workflow.js',
  'hl-editor/editorial/application/editorial-workflow-service.js',
  'hl-editor/editorial/ports/editorial-workflow-repository.js',
  'hl-editor/editorial/ports/visual-asset-gateway.js',
  'hl-editor/editorial/infrastructure/browser-editorial-workflow-repository.js',
  'hl-editor/editorial/infrastructure/browser-visual-asset-gateway.js',
  'hl-editor/editorial/presentation/editorial-workspace.js',
  'hl-editor/editorial/presentation/editorial-workspace.css'
];

for (const file of required) {
  try { await access(file); }
  catch { console.error(`Editorial architecture missing: ${file}`); process.exit(1); }
}

const presentation = await readFile('hl-editor/editorial/presentation/editorial-workspace.js', 'utf8');
if (/\/infrastructure\//.test(presentation) || /heartline-db\.js/.test(presentation) || /new MutationObserver/.test(presentation)) {
  console.error('Editorial Presentation violates dependency/lifecycle rules');
  process.exit(1);
}

const application = await readFile('hl-editor/editorial/application/editorial-workflow-service.js', 'utf8');
if (/\/infrastructure\//.test(application) || /\bdocument\.|\bwindow\./.test(application)) {
  console.error('Editorial Application depends on Infrastructure or DOM');
  process.exit(1);
}

const domain = await readFile('hl-editor/editorial/domain/editorial-workflow.js', 'utf8');
for (const token of ["'text'", "'visual'", "'final'", 'textHash', 'visualHash']) {
  if (!domain.includes(token)) {
    console.error(`Editorial Domain contract missing: ${token}`);
    process.exit(1);
  }
}

const entry = await readFile('hl-editor/index.js', 'utf8');
if (!entry.includes('editorial/presentation/editorial-workspace.js') || entry.includes('proofreading/presentation/proofreading-workspace.js')) {
  console.error('Composition entry still owns the obsolete standalone proofreading Presentation');
  process.exit(1);
}

const app = await readFile('heartline-app.js', 'utf8');
if (!app.includes('HEARTLINEEditorialWorkspace') || !app.includes("route === 'preview'")) {
  console.error('Legacy reader/preview routes are not delegated to Editorial Workspace');
  process.exit(1);
}

const index = await readFile('index.html', 'utf8');
if (/data-route="preview"[^>]*>Превью</.test(index)) {
  console.error('Standalone Preview navigation is still visible');
  process.exit(1);
}

console.log('Editorial workflow architecture: PASS');
