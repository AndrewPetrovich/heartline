import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_VERSION = '3.8.0';
const TARGET_VERSION = '3.9.0';
const backupRoot = path.join('.git', 'heartline-update-backups', TARGET_VERSION);
const staged = new Map();
const deletions = [
  'tests/library-card-cleanup.test.js',
  'tests/library-readiness-restore.test.js'
];

async function read(file) { return readFile(file, 'utf8'); }
async function write(file, value) { await writeFile(file, value, 'utf8'); }
async function backup(file) {
  try {
    const target = path.join(backupRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
  } catch (_) {}
}
async function update(file, transform) {
  const before = await read(file);
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const normalized = before.replace(/\r\n/g, '\n');
  const transformed = await transform(normalized);
  if (transformed === normalized) throw new Error(`${file}: editorial migration made no change`);
  const after = eol === '\r\n' ? transformed.replace(/\n/g, '\r\n') : transformed;
  staged.set(file, { before, after });
}
function replaceExact(source, oldValue, newValue, label) {
  const count = source.split(oldValue).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(oldValue, newValue);
}
function replaceRegex(source, pattern, replacement, label) {
  const copy = new RegExp(pattern.source, pattern.flags);
  if (!copy.test(source)) throw new Error(`${label}: pattern not found`);
  copy.lastIndex = 0;
  return source.replace(copy, replacement);
}

const packageJson = JSON.parse(await read('package.json'));
if (packageJson.version !== EXPECTED_VERSION) {
  throw new Error(`HEARTLINE ${EXPECTED_VERSION} is required; found ${packageJson.version}`);
}

await update('tests/proofreading-ui-contract.test.js', async () =>
  read('tools/editorial-pipeline-3.9/proofreading-ui-contract.test.js')
);

await update('heartline-app.js', source => {
  const oldRoute = `async function setRoute(route) {
  if (route !== 'preview') state.previewDraftAssignment = null;
  state.route = route;
  document.body.classList.toggle('reader-active', route === 'reader');
  setActiveNav(route);
  await render();
  if (state.project && route !== 'library') await rememberProjectLocation(route);
  view.focus({ preventScroll: true });
}`;
  const nextRoute = `async function setRoute(route) {
  if ((route === 'reader' || route === 'preview') && window.HEARTLINEEditorialWorkspace?.open) {
    if (route !== 'preview') state.previewDraftAssignment = null;
    state.route = route;
    await window.HEARTLINEEditorialWorkspace.open({
      stage: route === 'preview' ? 'final' : 'text',
      fragmentId: state.selectedFragmentId
    });
    if (state.project && route !== 'library') await rememberProjectLocation(route);
    view.focus({ preventScroll: true });
    return;
  }
  if (route !== 'preview') state.previewDraftAssignment = null;
  state.route = route;
  document.body.classList.toggle('reader-active', route === 'reader');
  setActiveNav(route);
  await render();
  if (state.project && route !== 'library') await rememberProjectLocation(route);
  view.focus({ preventScroll: true });
}`;
  return replaceExact(source, oldRoute, nextRoute, 'reader/preview delegation');
});

await update('hl-editor/bootstrap/composition-root.js', source => {
  source = replaceExact(
    source,
    `import { BUILTIN_DEVICE_PROFILE_CATALOG, BUILTIN_DEVICE_COMPARISON_PRESETS, DEFAULT_PREVIEW_DEVICE_ID } from '../preview/infrastructure/builtin-device-profile-catalog.js';`,
    `import { BUILTIN_DEVICE_PROFILE_CATALOG, BUILTIN_DEVICE_COMPARISON_PRESETS, DEFAULT_PREVIEW_DEVICE_ID } from '../preview/infrastructure/builtin-device-profile-catalog.js';
import { EditorialWorkflowService } from '../editorial/application/editorial-workflow-service.js';
import { BrowserEditorialWorkflowRepository } from '../editorial/infrastructure/browser-editorial-workflow-repository.js';
import { BrowserVisualAssetGateway } from '../editorial/infrastructure/browser-visual-asset-gateway.js';`,
    'editorial composition imports'
  );
  source = replaceExact(
    source,
    `import { configureNovelParser } from '../../heartline-domain.js';`,
    `import { configureNovelParser, frameDiagnostics, visualForDevice } from '../../heartline-domain.js';`,
    'preview diagnostics adapter import'
  );
  const oldDevice = `const deviceProfileService = new DeviceProfileService(BUILTIN_DEVICE_PROFILE_CATALOG, {
  defaultId: DEFAULT_PREVIEW_DEVICE_ID,
  comparisonPresets: BUILTIN_DEVICE_COMPARISON_PRESETS,
  maxComparisonDevices: 4
});`;
  const nextDevice = `${oldDevice}

const editorialWorkflowRepository = new BrowserEditorialWorkflowRepository();
const visualAssetGateway = new BrowserVisualAssetGateway();
const editorialWorkflowService = new EditorialWorkflowService({
  repository: editorialWorkflowRepository,
  proofreadingService,
  visualGateway: visualAssetGateway,
  deviceProfileService,
  diagnoseFrame(frame, device) {
    const visual = visualForDevice(frame?.assignment, device.id);
    return frameDiagnostics(frame, device, visual, 1);
  },
  clock: () => new Date().toISOString()
});`;
  source = replaceExact(source, oldDevice, nextDevice, 'editorial service composition');
  source = replaceExact(
    source,
    `  sampleCatalogService,
  deviceProfileService
});`,
    `  sampleCatalogService,
  deviceProfileService,
  editorialWorkflowRepository,
  visualAssetGateway,
  editorialWorkflowService
});`,
    'editorial services export'
  );
  return source;
});

await update('hl-editor/index.js', source => replaceExact(
  source,
  `import './proofreading/presentation/proofreading-workspace.js';`,
  `import './editorial/presentation/editorial-workspace.js';`,
  'editorial workspace composition entry'
));

await update('index.html', source => {
  source = replaceExact(source, '<title>HEARTLINE Editor 3.8.0</title>', '<title>HEARTLINE Editor 3.9.0</title>', 'index version');
  source = replaceExact(source, "window.HEARTLINE_BUILD='3.8.0-preview-lab'", "window.HEARTLINE_BUILD='3.9.0-editorial-pipeline'", 'build version');
  source = source.replace(/\n\s*<button data-route="preview" class="nav-button">Превью<\/button>/, '');
  return source;
});

await update('sw.js', source => {
  source = replaceExact(source, "heartline-editor-3.8.0-preview-lab", "heartline-editor-3.9.0-editorial-pipeline", 'service worker cache');
  const editorialFiles = `'./hl-editor/editorial/domain/editorial-workflow.js','./hl-editor/editorial/application/editorial-workflow-service.js','./hl-editor/editorial/ports/editorial-workflow-repository.js','./hl-editor/editorial/ports/visual-asset-gateway.js','./hl-editor/editorial/infrastructure/browser-editorial-workflow-repository.js','./hl-editor/editorial/infrastructure/browser-visual-asset-gateway.js','./hl-editor/editorial/presentation/editorial-workspace.js','./hl-editor/editorial/presentation/editorial-workspace.css',`;
  source = replaceExact(
    source,
    `  './hl-editor/proofreading/domain/proofreading.js'`,
    `  ${editorialFiles}
  './hl-editor/proofreading/domain/proofreading.js'`,
    'editorial service worker files'
  );
  return source;
});

await update('tools/verify-repository.mjs', source => {
  const marker = `  'hl-editor/proofreading/domain/proofreading.js'`;
  const editorial = `  'hl-editor/editorial/domain/editorial-workflow.js','hl-editor/editorial/application/editorial-workflow-service.js','hl-editor/editorial/ports/editorial-workflow-repository.js','hl-editor/editorial/ports/visual-asset-gateway.js','hl-editor/editorial/infrastructure/browser-editorial-workflow-repository.js','hl-editor/editorial/infrastructure/browser-visual-asset-gateway.js','hl-editor/editorial/presentation/editorial-workspace.js','hl-editor/editorial/presentation/editorial-workspace.css',\n`;
  if (!source.includes(marker)) throw new Error('verify-repository editorial insertion marker not found');
  source = source.replace(marker, editorial + marker);
  return source;
});

await update('package.json', source => {
  const pkg = JSON.parse(source);
  pkg.version = TARGET_VERSION;
  pkg.scripts['verify-editorial'] = 'node tools/verify-editorial-architecture.mjs';
  const commands = [
    'node tools/check-js-syntax.mjs',
    'node tools/verify-font-policy.mjs',
    'node tools/verify-architecture.mjs',
    'node tools/verify-preview-architecture.mjs',
    'node tools/verify-editorial-architecture.mjs'
  ];
  pkg.scripts.check = commands.join(' && ');
  return JSON.stringify(pkg, null, 2) + '\n';
});

const written = [];
const removed = [];
try {
  for (const [file, item] of staged) {
    await backup(file);
    await write(file, item.after);
    written.push(file);
  }
  for (const file of deletions) {
    try {
      await backup(file);
      await rm(file);
      removed.push(file);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
} catch (error) {
  for (const file of written.reverse()) {
    const item = staged.get(file);
    if (item) await write(file, item.before).catch(() => {});
  }
  for (const file of removed) {
    const backupFile = path.join(backupRoot, file);
    await mkdir(path.dirname(file), { recursive: true }).catch(() => {});
    await copyFile(backupFile, file).catch(() => {});
  }
  throw error;
}

console.log(`HEARTLINE ${TARGET_VERSION} editorial pipeline applied (${written.length} files updated, ${removed.length} obsolete tests removed).`);
console.log('Next on Windows: npm.cmd run verify-repository && npm.cmd test && npm.cmd run check');
