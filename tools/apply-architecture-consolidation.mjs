import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_VERSION = '3.6.4';
const TARGET_VERSION = '3.7.0';
const backupRoot = path.join('.git', 'heartline-update-backups', TARGET_VERSION);

async function read(file) { return readFile(file, 'utf8'); }
async function write(file, value) { await writeFile(file, value, 'utf8'); }
async function backup(file) {
  try {
    const target = path.join(backupRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
  } catch (_) {}
}
const staged = new Map();
async function update(file, transform) {
  const before = await read(file);
  const after = await transform(before);
  if (after === before) throw new Error(`${file}: architecture migration made no change`);
  staged.set(file, { before, after });
}
function replaceExact(source, oldValue, newValue, label) {
  const count = source.split(oldValue).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(oldValue, newValue);
}
function replaceRegex(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`${label}: pattern not found`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

const packageJson = JSON.parse(await read('package.json'));
if (packageJson.version !== EXPECTED_VERSION) throw new Error(`HEARTLINE ${EXPECTED_VERSION} is required; found ${packageJson.version}`);

await update('heartline-domain.js', source => {
  const oldParser = `export function parser() {
  if (!window.HEARTLINEParser) throw new Error('Parser HEARTLINE не загружен');
  return window.HEARTLINEParser;
}`;
  const newParser = `let novelParser = null;
export function configureNovelParser(parserAdapter) { novelParser = parserAdapter; }
export function parser() {
  if (!novelParser) throw new Error('Novel parser adapter is not configured');
  return novelParser;
}`;
  return replaceExact(source, oldParser, newParser, 'domain parser dependency injection');
});

await update('heartline-db.js', source => {
  source = replaceExact(source, `let openPromise = null;`, `let openPromise = null;
let parserAdapter = null;

export function configureDbAdapters({ parser } = {}) { parserAdapter = parser || null; }`, 'DB adapter injection');
  source = replaceExact(source, `  const parser = typeof window !== 'undefined' ? window.HEARTLINEParser : null;
  const fragments = parser?.flattenFragments ? parser.flattenFragments(content) : [];`, `  const fragments = parserAdapter?.flattenFragments ? parserAdapter.flattenFragments(content) : [];`, 'DB parser global removal');
  return source;
});

await update('heartline-app.js', source => {
  source = replaceExact(source, "import * as DB from './heartline-db.js';", "import * as DB from './hl-editor/application/legacy-editor-gateway.js';", 'legacy storage boundary');
  source = replaceExact(source, "import * as Assets from './heartline-assets.js';", "import * as Assets from './hl-editor/application/asset-application-service.js';", 'asset application boundary');
  source = source.replace("font: 'serif'", "font: 'sans'");
  const oldCatalog = `  const builtins = [\n    { file: './novel.json', stableId: 'poslednyaya-podacha', aliases: ['poslednyaya-podacha-heartline-branching2-20260808'], sourceType: 'builtin-poslednyaya-podacha' },\n    { file: './moon-oath.json', stableId: 'moon_oath', aliases: [], sourceType: 'builtin-moon-oath' }\n  ];`;
  const nextCatalog = `  let builtins = [];\n  try { builtins = await window.HEARTLINEApp.services.sampleCatalogService.list(); }\n  catch (error) { console.warn('Не удалось загрузить каталог встроенных проектов', error); return; }`;
  source = replaceExact(source, oldCatalog, nextCatalog, 'sample catalog');
  return source;
});

await update('hl-editor/config.js', source => replaceExact(
  source,
  "  sourceDocumentCandidates: Object.freeze(['novel.json']),\n",
  '',
  'adapter-specific source filename removal'
));

await update('hl-editor/application/project-service.js', source => replaceExact(
  source,
  "    const existingDocument = stored?.documents?.find(item => item.relativePath === source.relativePath);\n    const documentId = existingDocument?.documentId || this.uuid();",
  "    const knownDocuments = stored?.documents || [];\n    const existingDocument = knownDocuments.find(item => item.relativePath === source.relativePath) || (knownDocuments.length === 1 ? knownDocuments[0] : null);\n    const documentId = existingDocument?.documentId || this.uuid();",
  'document identity/path decoupling'
));

await update('hl-editor/infrastructure/browser-context-repository.js', source => replaceExact(
  source,
  "      projectId, title, activeVersionId: versionId, sourceBacked: false, transportOnly: true,\n      formatVersion: 4, createdAt: now, updatedAt: now,",
  "      projectId, title, activeVersionId: versionId, sourceBacked: false, transportOnly: true, requiresSourceAttachment: true,\n      formatVersion: 4, createdAt: now, updatedAt: now,",
  'transport project source warning'
));

await update('hl-editor/presentation/bridge.js', source => {
  const oldTop = `import * as DB from '../../heartline-db.js';\nimport * as Domain from '../../heartline-domain.js';\nimport { mergePolicies } from '../config.js';\nimport { BrowserHashService } from '../infrastructure/browser-hash-service.js';\nimport { BrowserFsSourceProjectAdapter } from '../infrastructure/browser-fs-source-adapter.js';\nimport { BrowserProjectContextRepository } from '../infrastructure/browser-context-repository.js';\nimport { ProjectService } from '../application/project-service.js';\nimport { ImportService } from '../application/import-service.js';\nimport { SourceConflictError } from '../ports/source-project-adapter.js';\n\nconst parser = window.HEARTLINEParser;\nconst policies = mergePolicies();\nconst contextRepository = new BrowserProjectContextRepository();\nconst sourceAdapter = new BrowserFsSourceProjectAdapter({ policies, parser });\nconst projectService = new ProjectService({\n  sourceAdapter,\n  contextRepository,\n  hashService: new BrowserHashService(),\n  uuid: () => crypto.randomUUID(),\n  clock: () => new Date().toISOString(),\n  policies\n});\nconst importService = new ImportService({\n  contextRepository, projectService, parser,\n  uuid: () => crypto.randomUUID(),\n  clock: () => new Date().toISOString(),\n  policies\n});`;
  const newTop = `import * as DB from '../application/legacy-editor-gateway.js';\nimport * as Domain from '../../heartline-domain.js';\nimport { getAppServices } from '../application/service-container.js';\nimport { SourceConflictError } from '../ports/source-project-adapter.js';\n\nconst { policies, projectService, importService } = getAppServices();`;
  source = replaceExact(source, oldTop, newTop, 'bridge composition root');
  const oldTail = `const observer = new MutationObserver(() => { enhanceLibrary(); enhanceExport(); });\nobserver.observe(document.documentElement, { childList: true, subtree: true });\n\ninstallStyles();\nensureBanner();\nsetTimeout(() => { enhanceLibrary(); enhanceExport(); surfaceRecovery().catch(error => logTechnical('recovery', error)); }, 0);\n\nwindow.HEARTLINEProjectCore = Object.freeze({ projectService, importService, connectSourceFolder, flushSourceSave, createBackupForActiveProject });`;
  const newTail = `installStyles();\nensureBanner();\nsetTimeout(() => { enhanceLibrary(); enhanceExport(); surfaceRecovery().catch(error => logTechnical('recovery', error)); }, 0);\n\nwindow.HEARTLINEProjectCore = Object.freeze({ projectService, importService, connectSourceFolder, flushSourceSave, createBackupForActiveProject });\nwindow.HEARTLINEProjectBridge = Object.freeze({ enhance() { enhanceLibrary(); enhanceExport(); }, surfaceRecovery });`;
  return replaceExact(source, oldTail, newTail, 'bridge presentation lifecycle');
});

await update('hl-editor/proofreading/presentation/proofreading-workspace.js', source => {
  source = replaceExact(
    source,
    "import { BrowserProofreadingRepository } from '../infrastructure/browser-proofreading-repository.js';\nimport { ProofreadingService } from '../application/proofreading-service.js';\nimport { TEXT_REVIEW_CATEGORIES, workflowStatusFromLegacy } from '../domain/proofreading.js';",
    "import { getAppServices } from '../../application/service-container.js';\nimport { TEXT_REVIEW_CATEGORIES, workflowStatusFromLegacy } from '../domain/proofreading.js';",
    'proofreading DI imports'
  );
  source = replaceExact(source, 'const repository = new BrowserProofreadingRepository();\n', '', 'proofreading repository construction');
  const oldService = `function getService() {\n  if (service) return service;\n  service = new ProofreadingService({\n    repository,\n    projectService: window.HEARTLINEProjectCore?.projectService || null,\n    uuid: () => crypto.randomUUID(),\n    clock: () => new Date().toISOString()\n  });\n  return service;\n}`;
  source = replaceExact(source, oldService, `function getService() {\n  service ||= getAppServices().proofreadingService;\n  return service;\n}`, 'proofreading service construction');
  const oldTail = `const observer = new MutationObserver(() => { installNavigation(); adaptLegacyUi(); redirectLegacyReaderIfNeeded(); });\nobserver.observe(document.documentElement, { childList: true, subtree: true });\ndocument.addEventListener('keydown', proofreadingHotkeys);\ninstallStyles();\ninstallNavigation();\nadaptLegacyUi();\nredirectLegacyReaderIfNeeded();\n\nwindow.HEARTLINEProofreading = Object.freeze({ open: openProofreading, get service() { return getService(); } });`;
  const newTail = `document.addEventListener('keydown', proofreadingHotkeys);\ninstallStyles();\ninstallNavigation();\nadaptLegacyUi();\nredirectLegacyReaderIfNeeded();\n\nwindow.HEARTLINEProofreading = Object.freeze({\n  open: openProofreading,\n  get service() { return getService(); },\n  enhance() { installNavigation(); adaptLegacyUi(); redirectLegacyReaderIfNeeded(); }\n});`;
  return replaceExact(source, oldTail, newTail, 'proofreading presentation lifecycle');
});

await update('hl-editor/presentation/design-system.js', source => {
  const libraryPattern = /      const stats = card\.querySelector\('\.project-stats-grid'\);[\s\S]*?      if \(detailsBody && production && production\.parentElement !== detailsBody\) detailsBody\.appendChild\(production\);/;
  const libraryReplacement = `      const placeholder = card.querySelector('.project-cover-placeholder');\n      placeholder?.querySelectorAll(':scope > span, :scope > strong').forEach(node => node.remove());\n      card.querySelectorAll('.hl-project-details,.project-stats-grid,.project-production-row').forEach(node => node.remove());\n      const details = null;`;
  source = replaceRegex(source, libraryPattern, libraryReplacement, 'library single owner');
  const oldTail = `installStyles();\nconst observer = new MutationObserver(scheduleEnhance);\nobserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });\ndocument.addEventListener('click', scheduleEnhance, true);\nscheduleEnhance();\n\nwindow.HEARTLINEDesignSystem = Object.freeze({ enhance: scheduleEnhance, version: '1.1.0' });`;
  const newTail = `installStyles();\nscheduleEnhance();\n\nwindow.HEARTLINEDesignSystem = Object.freeze({ enhance: scheduleEnhance, version: '1.2.0' });`;
  return replaceExact(source, oldTail, newTail, 'design system lifecycle');
});

await update('hl-editor/presentation/font-policy.js', source => {
  const oldTail = `installStyle();\nnormalizeReaderPreference();\nremoveLegacyFontControl();\n\nconst observer = new MutationObserver(records => {\n  for (const record of records) {\n    for (const node of record.addedNodes) inspectAddedNode(node);\n  }\n  removeLegacyFontControl();\n});\nobserver.observe(document.documentElement, { childList: true, subtree: true });\n\nwindow.HEARTLINEFontPolicy = Object.freeze({\n  family: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Arial, sans-serif',\n  version: '1.0.0'\n});`;
  const newTail = `function applyFontPolicy() {\n  installStyle();\n  normalizeReaderPreference();\n  removeLegacyFontControl();\n}\n\napplyFontPolicy();\nwindow.HEARTLINEFontPolicy = Object.freeze({\n  family: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Arial, sans-serif',\n  apply: applyFontPolicy,\n  version: '1.1.0'\n});`;
  source = replaceExact(source, oldTail, newTail, 'font policy lifecycle');
  source = source.replace(/\nfunction inspectAddedNode\(node\) \{[\s\S]*?\n\}/, '');
  return source;
});

await update('heartline-parser.js', source => {
  source = replaceExact(source, "  const slug=s=>String(s||'').normalize('NFKD').replace(/[^A-Za-z0-9А-Яа-яЁё_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64)||'novel';", "  const slug=s=>String(s||'').normalize('NFKD').replace(/[^A-Za-z0-9А-Яа-яЁё_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64)||'novel';\n  const storyProfiles=()=>globalThis.HEARTLINEStoryProfiles||null;", 'parser story profile bridge');
  source = replaceRegex(source, /  function chapterForScene\(scene,index\)\{[^\n]+\}/, "  function chapterForScene(scene,index){if(scene.chapterId)return{chapterId:scene.chapterId,chapterTitle:scene.chapterTitle||scene.chapterId};return{chapterId:'chapter:other',chapterTitle:'Другие сцены'};}", 'parser chapter hardcode');
  source = replaceExact(source, "  function ensureStableIds(novel){if(!novel.id)novel.id=`novel-${uid('n').toLowerCase()}`;novel.schemaVersion=2;for(let si=0;si<(novel.scenes||[]).length;si++){const s=novel.scenes[si];if(!s.id)s.id=`SC_${String(si+1).padStart(3,'0')}`;const ch=chapterForScene(s,si);s.chapterId=ch.chapterId;s.chapterTitle=s.chapterTitle||ch.chapterTitle;s.order=si;assignSteps(s.steps||[],s.id,[]);}return novel;}", "  function ensureStableIds(novel){if(!novel.id)novel.id=`novel-${uid('n').toLowerCase()}`;novel.schemaVersion=2;for(let si=0;si<(novel.scenes||[]).length;si++){const s=novel.scenes[si];if(!s.id)s.id=`SC_${String(si+1).padStart(3,'0')}`;const ch=chapterForScene(s,si);s.chapterId=ch.chapterId;s.chapterTitle=s.chapterTitle||ch.chapterTitle;s.order=si;assignSteps(s.steps||[],s.id,[]);}return storyProfiles()?.enrichNovel?.(novel)||novel;}", 'parser profile enrichment');
  source = replaceRegex(source, /  function dynamicTargets\(raw,ids\)\{[^\n]+\}/, "  function dynamicTargets(raw,ids,novel=null){const t=String(raw||'').trim().replace(/[.;]+$/,'');if(ids.has(t))return[t];return storyProfiles()?.staticTargets?.(novel,raw,ids)||[];}", 'parser dynamic target hardcode');
  source = replaceExact(source, "sets=new Set(['HONESTY','ATTRACTION','TRUST','PROFESSIONAL_COST'])", "sets=new Set(Object.keys(storyProfiles()?.initialVariables?.(novel)||novel.initialVars||{}))", 'parser variable hardcode');
  source = source.replaceAll('dynamicTargets(raw,sceneIds)', 'dynamicTargets(raw,sceneIds,novel)');
  source = replaceExact(source, "if(!targets.length&&!/соответствующая маршрутная сцена|согласно ROUTE_ID/i.test(String(raw||'')))errors.push", "if(!targets.length)errors.push", 'parser route exception hardcode');
  return source;
});

await update('heartline-engine.js', source => {
  source = replaceExact(source, "import { clone, now } from './heartline-domain.js';", "import { clone, now } from './heartline-domain.js';\nimport { resolveStoryProfile } from './hl-editor/application/story-profile-runtime.js';", 'engine profile import');
  source = replaceExact(source, "    vars: { HONESTY: 0, ATTRACTION: 0, TRUST: 0, PROFESSIONAL_COST: 0, ...(content.initialVars || {}) },", "    vars: { ...resolveStoryProfile(content).initialVariables(content), ...(content.initialVars || {}) },", 'engine initial variables');
  source = replaceExact(source, "  constructor(content, session) {\n    this.content = content;\n    this.session = session;\n  }", "  constructor(content, session) {\n    this.content = content;\n    this.session = session;\n    this.profile = resolveStoryProfile(content);\n  }", 'engine profile construction');
  source = replaceRegex(source, /  evaluateRoute\(\) \{[\s\S]*?\n  \}\n  executeSystem\(value\) \{[\s\S]*?\n  \}\n  resolveGoto\(raw\) \{[\s\S]*?\n  \}/, `  evaluateRoute() {\n    return Boolean(this.profile?.evaluateRoute?.({ get: key => this.variable(key), set: (key, value) => this.setVariable(key, value) }));\n  }\n  executeSystem(value) {\n    const source = String(value || '').trim();\n    const handled = this.profile?.executeSystem?.({\n      source, get: key => this.variable(key), set: (key, next) => this.setVariable(key, next),\n      applySet: item => this.applySet(item),\n      end: text => { this.session.ended = true; this.pushEnd(text || 'Конец маршрута.'); }\n    });\n    if (handled) return;\n    if (/^END\\b/i.test(source)) { this.session.ended = true; this.pushEnd('Конец доступного сценария.'); }\n  }\n  resolveGoto(raw) {\n    const target = String(raw || '').trim().replace(/[.;]+$/, '');\n    return this.profile?.resolveGoto?.({ target, get: key => this.variable(key), hasScene: id => Boolean(this.scene(id)) }) || target;\n  }`, 'engine novel-specific runtime');
  source = source.replace('    let safety = 0;\n    while (safety++ < 800) {', '    const maxAdvanceSteps = 800;\n    let safety = 0;\n    while (safety++ < maxAdvanceSteps) {');
  return source;
});

await update('heartline-graph-model.js', source => {
  source = replaceExact(source, "import { sceneFrameMetrics } from './heartline-domain.js';", "import { sceneFrameMetrics } from './heartline-domain.js';\nimport { resolveStoryProfile } from './hl-editor/application/story-profile-runtime.js';", 'graph profile import');
  source = replaceRegex(source, /const ROUTE_LABELS = \{[\s\S]*?\n\};/, "const ROUTE_LABELS = Object.freeze({ common: 'Общая линия', conditional: 'Условные фрагменты', unclassified: 'Не классифицировано' });", 'graph route labels');
  source = replaceRegex(source, /function conditionDecisionIds\(value\) \{[\s\S]*?\n\}/, `function conditionDecisionIds(value) {\n  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value || '');\n  return uniq([...raw.matchAll(/\\bchoice\\.([A-Za-z0-9_-]+)\\b/gi)].map(match => match[1]));\n}`, 'graph decision id convention');
  source = replaceRegex(source, /function routeKey\(scene, sourceLayoutByScene = new Map\(\)\) \{[\s\S]*?\n\}/, `function routeKey(scene, sourceLayoutByScene = new Map(), content = null) {\n  const layout = sourceLayoutByScene.get(scene?.id) || null;\n  return resolveStoryProfile(content).routeKey({ scene, layout, content }) || 'common';\n}`, 'graph route key hardcode');
  source = replaceExact(source, 'function logicalDecisions(occurrences, sceneRecords) {', 'function logicalDecisions(occurrences, sceneRecords, content) {', 'graph decision profile signature');
  source = replaceExact(source, "    const mainLattice = /^C(?:0[1-9]|1\\d|2[0-2])$/i.test(choiceId);", "    const mainLattice = Boolean(resolveStoryProfile(content).isMainDecision?.(choiceId));", 'graph lattice hardcode');
  source = replaceRegex(source, /function resolveTarget\(raw, sceneIds\) \{[\s\S]*?\n\}/, `function resolveTarget(raw, sceneIds, content = null) {\n  const value = String(raw || '').trim().replace(/[.;]+$/, '').replace(/^GOTO\\s+/i, '').trim();\n  if (!value) return [];\n  if (sceneIds.has(value)) return [value];\n  return resolveStoryProfile(content).staticTargets({ content, raw: value, sceneIds }) || [];\n}`, 'graph dynamic targets');
  source = replaceExact(source, "    const endingId = String(item?.id || String.fromCharCode(65 + index)).toUpperCase();\n    return {", "    const endingId = String(item?.id || String.fromCharCode(65 + index)).toUpperCase();\n    const endingRoute = resolveStoryProfile(content).endingRouteKey({ item, index, endingId, content });\n    return {", 'graph ending profile setup');
  source = replaceExact(source, "      routeKey: endingId === 'A' ? 'oath' : endingId === 'B' ? 'network' : endingId === 'C' ? 'break' : 'common',\n      laneId: endingId === 'A' ? 'oath' : endingId === 'B' ? 'network' : endingId === 'C' ? 'break' : 'common',\n      storylineIds: [endingId === 'A' ? 'oath' : endingId === 'B' ? 'network' : endingId === 'C' ? 'break' : 'common'],", "      routeKey: endingRoute,\n      laneId: endingRoute,\n      storylineIds: [endingRoute],", 'graph ending route hardcode');
  source = source.replaceAll('routeKey(scene, sourceLayoutByScene)', 'routeKey(scene, sourceLayoutByScene, content)');
  source = source.replaceAll('resolveTarget(raw, ids)', 'resolveTarget(raw, ids, content)');
  source = replaceExact(source, "title: key === 'common' ? items[0]?.title || 'Финал' : ROUTE_LABELS[key] || items[0]?.title || 'Финал',", "title: key === 'common' ? items[0]?.title || 'Финал' : resolveStoryProfile(content).routeLabel(key) || items[0]?.title || 'Финал',", 'graph ending labels');
  source = replaceExact(source, 'function attachEndings(edges, endings, scenes, sourceLayoutByScene) {', 'function attachEndings(edges, endings, scenes, sourceLayoutByScene, content) {', 'graph attach ending signature');
  source = replaceExact(source, 'function sourceDrivenStoryline(scene, sourceLayoutByScene, overrides = {}) {', 'function sourceDrivenStoryline(scene, sourceLayoutByScene, overrides = {}, content = null) {', 'graph storyline signature');
  source = replaceExact(source, 'function storylineCatalog(sceneRecords) {\n  const ids = uniq(sceneRecords.flatMap(scene => scene.storylineIds));\n  const order = [\'common\', \'equal\', \'fire\', \'mask\', \'direct\', \'conditional\', \'oath\', \'network\', \'break\', \'unclassified\'];\n  return ids.map(id => ({ id, title: ROUTE_LABELS[id] || id, order: order.indexOf(id) >= 0 ? order.indexOf(id) : 99 })).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, \'ru\'));\n}', `function storylineCatalog(sceneRecords, content) {\n  const ids = uniq(sceneRecords.flatMap(scene => scene.storylineIds));\n  const profile = resolveStoryProfile(content);\n  return ids.map((id, index) => ({ id, title: profile.routeLabel(id) || ROUTE_LABELS[id] || id, order: profile.storylineOrder?.(id, index) ?? index })).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));\n}`, 'graph storyline catalog');
  source = source.replace('const classification = sourceDrivenStoryline(scene, sourceLayoutByScene, graphOverrides || content?.storyMetadata?.graphOverrides || {});', 'const classification = sourceDrivenStoryline(scene, sourceLayoutByScene, graphOverrides || content?.storyMetadata?.graphOverrides || {}, content);');
  source = source.replace('const decisions = logicalDecisions(occurrences, sceneRecords);', 'const decisions = logicalDecisions(occurrences, sceneRecords, content);');
  source = source.replace('edges = attachEndings(edges, endings, sceneRecords, sourceLayoutByScene);', 'edges = attachEndings(edges, endings, sceneRecords, sourceLayoutByScene, content);');
  source = source.replace('storylines: storylineCatalog(sceneRecords),', 'storylines: storylineCatalog(sceneRecords, content),');
  source = source.replace(/\n    c15Occurrences:.*?,/, '').replace(/\n    c18Occurrences:.*?,/, '');
  source = source.replace("    decision.influencesEnding = decision.choiceId === 'FINAL' || decision.affectedSceneIds.some(id => /(?:ch1[01]|ep|final)/i.test(id)) || /финал|кульминац/i.test(`${decision.title} ${decision.editorialTrace}`);", "    decision.influencesEnding = decision.affectedSceneIds.some(id => sceneRecords.some(scene => scene.id === id && sceneEnds(scene))) || /финал|кульминац/i.test(`${decision.title} ${decision.editorialTrace}`);");
  return source;
});

// Centralize the sole Presentation lifecycle in hl-editor/index.js.
await update('hl-editor/index.js', _source => `import './bootstrap/composition-root.js';\nimport './presentation/bridge.js';\nimport './proofreading/presentation/proofreading-workspace.js';\nimport './presentation/design-system.js';\nimport './presentation/font-policy.js';\nimport './presentation/presentation-coordinator.js';\n`);

// Remove superseded DOM patch module only after every transformation validates.
const deletes = ['hl-editor/presentation/library-card-cleanup.js', 'hl-editor/presentation/library-card-cleanup.css'];

await update('tools/verify-repository.mjs', source => {
  source = source.replace("'hl-editor/presentation/font-policy.js','hl-editor/presentation/font-policy.css','hl-editor/presentation/library-card-cleanup.js','hl-editor/presentation/library-card-cleanup.css',", "'hl-editor/presentation/font-policy.js','hl-editor/presentation/font-policy.css','hl-editor/presentation/presentation-coordinator.js','hl-editor/bootstrap/composition-root.js','hl-editor/application/story-profile-runtime.js','hl-editor/application/story-profile-registry.js','hl-editor/application/service-container.js','hl-editor/application/source-adapter-registry.js','hl-editor/application/legacy-editor-gateway.js','hl-editor/application/asset-application-service.js','hl-editor/application/sample-catalog-service.js','hl-editor/ports/story-format-profile.js','hl-editor/ports/sample-catalog-repository.js','hl-editor/infrastructure/story-profiles/generic-story-profile.js','hl-editor/infrastructure/story-profiles/legacy-heartline-story-profile.js','hl-editor/infrastructure/source-adapters/heartline-json-source-adapter.js','hl-editor/infrastructure/source-adapters/heartline-json-source-policy.js','hl-editor/infrastructure/browser-sample-catalog-repository.js','samples/catalog.json',");
  source = source.replace('||!editorEntry.includes("presentation/library-card-cleanup.js")', '||!editorEntry.includes("presentation/presentation-coordinator.js")||!editorEntry.includes("bootstrap/composition-root.js")');
  return source;
});

await update('sw.js', source => {
  source = source.replace(/heartline-editor-3\.6\.4-readiness-restored/, 'heartline-editor-3.7.0-architecture-consolidation');
  source = source.replace("'./hl-editor/presentation/font-policy.js','./hl-editor/presentation/font-policy.css','./hl-editor/presentation/library-card-cleanup.js','./hl-editor/presentation/library-card-cleanup.css',", "'./hl-editor/presentation/font-policy.js','./hl-editor/presentation/font-policy.css','./hl-editor/presentation/presentation-coordinator.js','./hl-editor/bootstrap/composition-root.js','./hl-editor/application/story-profile-runtime.js','./hl-editor/application/story-profile-registry.js','./hl-editor/application/source-adapter-registry.js','./hl-editor/application/legacy-editor-gateway.js','./hl-editor/application/asset-application-service.js','./hl-editor/application/sample-catalog-service.js','./hl-editor/application/service-container.js','./hl-editor/ports/story-format-profile.js','./hl-editor/ports/sample-catalog-repository.js','./hl-editor/infrastructure/story-profiles/generic-story-profile.js','./hl-editor/infrastructure/story-profiles/legacy-heartline-story-profile.js','./hl-editor/infrastructure/source-adapters/heartline-json-source-adapter.js','./hl-editor/infrastructure/source-adapters/heartline-json-source-policy.js','./hl-editor/infrastructure/browser-sample-catalog-repository.js','./samples/catalog.json',");
  return source;
});

await update('index.html', source => source
  .replace('<title>HEARTLINE Editor 3.6.4</title>', '<title>HEARTLINE Editor 3.7.0</title>')
  .replace("window.HEARTLINE_BUILD='3.6.4-readiness-restored'", "window.HEARTLINE_BUILD='3.7.0-architecture-consolidation'")
);

packageJson.version = TARGET_VERSION;
packageJson.scripts['verify-architecture'] = 'node tools/verify-architecture.mjs';
packageJson.scripts.check = packageJson.scripts.check.includes('verify-architecture') ? packageJson.scripts.check : `${packageJson.scripts.check} && node tools/verify-architecture.mjs`;
staged.set('package.json', { before: await read('package.json'), after: JSON.stringify(packageJson, null, 2) + '\n' });

// Commit only after every expected source pattern has been validated in memory.
const committed = [];
const deleted = new Map();
try {
  for (const [file, value] of staged) {
    await backup(file);
    await write(file, value.after);
    committed.push(file);
  }
  for (const file of deletes) {
    try { deleted.set(file, await read(file)); } catch (_) { deleted.set(file, null); }
    await backup(file);
    await rm(file, { force: true });
  }
} catch (error) {
  for (const file of committed.reverse()) {
    const previous = staged.get(file)?.before;
    if (previous != null) { try { await write(file, previous); } catch (_) {} }
  }
  for (const [file, previous] of deleted) {
    if (previous != null) { try { await write(file, previous); } catch (_) {} }
  }
  throw error;
}

console.log(`HEARTLINE 3.7 architecture consolidation applied (${staged.size} files updated, ${deletes.length} obsolete patch files removed).`);
console.log('Next: npm run verify-repository && npm test && npm run check');
