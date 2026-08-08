// HEARTLINE Editor 3.1 Quality Pass — cross-device Reader, review, diff and preflight workflow
import * as DB from './heartline-db.js';
import * as Domain from './heartline-domain.js';
import { StoryEngine, createSession } from './heartline-engine.js';
import * as Assets from './heartline-assets.js';
import { DEVICE_PRESETS, renderPlayerFrame, renderDeviceComparison, orientedDevice } from './heartline-player-renderer.js';
import { buildGraph, layoutGraph, renderGraph, renderGraphOutline, renderGraphMinimap, enableGraphNavigation } from './heartline-graph.js';
import * as ProjectStats from './heartline-project-stats.js';

const $ = id => document.getElementById(id);
const view = $('view');
const modal = $('modal');
const exporter = window.HEARTLINEExporter;
const parser = window.HEARTLINEParser;


const READER_PREFS_KEY = 'heartline-reader-prefs-v1';
function loadReaderPrefs() {
  const defaults = { context: 'auto', textScale: 1, lineHeight: 1.58, font: 'serif', columnWidth: 790, focus: false };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(READER_PREFS_KEY) || '{}') }; }
  catch (_) { return defaults; }
}
function persistReaderPrefs() {
  localStorage.setItem(READER_PREFS_KEY, JSON.stringify({ context: state.readerContextCount, textScale: state.readerTextScale, lineHeight: state.readerLineHeight, font: state.readerFont, columnWidth: state.readerColumnWidth, focus: state.readerFocus }));
}
const INITIAL_READER_PREFS = loadReaderPrefs();

const state = {
  route: 'library',
  projects: [],
  project: null,
  versions: [],
  version: null,
  workspace: null,
  assignments: [],
  assignmentMap: new Map(),
  reviews: [],
  assets: [],
  assetMap: new Map(),
  session: null,
  engine: null,
  directFragmentId: null,
  selectedFragmentId: null,
  selectedSceneId: null,
  inspectorTab: 'frame',
  readerContextCount: INITIAL_READER_PREFS.context,
  readerTextScale: INITIAL_READER_PREFS.textScale,
  readerLineHeight: INITIAL_READER_PREFS.lineHeight,
  readerFont: INITIAL_READER_PREFS.font,
  readerColumnWidth: INITIAL_READER_PREFS.columnWidth,
  readerFocus: INITIAL_READER_PREFS.focus,
  libraryQuery: '',
  libraryView: 'active',
  librarySort: 'updated',
  librarySearchTimer: null,
  storyboardFilter: 'all',
  storyboardSelection: new Set(),
  storyboardLimit: 60,
  assetSearch: '',
  assetLimit: 80,
  reviewFilter: 'open',
  reviewGroup: 'scene',
  reviewSearch: '',
  reviewSelected: new Set(),
  reviewSearchTimer: null,
  previewDeviceId: 'iphone390',
  previewOrientation: 'portrait',
  previewCompare: false,
  previewTextScale: 1,
  previewPanelStyle: 'glass',
  previewDraftAssignment: null,
  previewMobileSheet: 'none',
  graphView: 'structure',
  graphFilter: 'all',
  graphSearch: '',
  graphSelected: null,
  graphNavigation: null,
  toastTimer: null,
  deferredInstall: null,
  selection: null,
  pendingVisualAnchor: null,
  storage: null
};

function toast(message, timeout = 2600) {
  clearTimeout(state.toastTimer);
  const element = $('toast');
  element.textContent = message;
  element.classList.remove('hidden');
  state.toastTimer = setTimeout(() => element.classList.add('hidden'), timeout);
}

function setActiveNav(route) {
  document.querySelectorAll('[data-route]').forEach(button => button.classList.toggle('active', button.dataset.route === route));
  document.querySelectorAll('.nav-group').forEach(group => {
    const active = Boolean(group.querySelector(`[data-route="${route}"]`));
    group.classList.toggle('active', active);
    if (!active) group.removeAttribute('open');
  });
}

async function setRoute(route) {
  if (route !== 'preview') state.previewDraftAssignment = null;
  state.route = route;
  document.body.classList.toggle('reader-active', route === 'reader');
  setActiveNav(route);
  await render();
  if (state.project && route !== 'library') await rememberProjectLocation(route);
  view.focus({ preventScroll: true });
}

function openModal({ kicker = '', title = '', body = '', footer = '' }) {
  $('modalKicker').textContent = kicker;
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = body;
  $('modalFooter').innerHTML = footer;
  modal.showModal();
}
function closeModal() { if (modal.open) modal.close(); }

function currentContent() { return state.version?.content || null; }
function workspaceScope() { return state.project ? DB.workspaceScope(state.project.projectId) : null; }
function currentFrames() { return currentContent() ? Domain.flattenFrames(currentContent()) : []; }
function currentAssignment(fragmentId = state.selectedFragmentId) { if (fragmentId === state.selectedFragmentId && state.previewDraftAssignment) return state.previewDraftAssignment; return state.assignmentMap.get(fragmentId) || null; }
function currentAsset(fragmentId = state.selectedFragmentId) {
  const assignment = currentAssignment(fragmentId);
  return assignment?.assetId ? state.assetMap.get(assignment.assetId) || null : null;
}
function currentReviews(fragmentId = state.selectedFragmentId) {
  return state.reviews.filter(review => review.fragmentId === fragmentId && !Domain.CLOSED_REVIEW_STATUSES.has(review.status));
}
function effectiveFrame(fragmentId = state.selectedFragmentId) {
  if (!fragmentId || !currentContent()) return null;
  return Domain.frameModel(currentContent(), fragmentId, state.workspace, currentAssignment(fragmentId), currentAsset(fragmentId), currentReviews(fragmentId));
}
function selectedFrameIndex() { return currentFrames().findIndex(frame => frame.fragmentId === state.selectedFragmentId); }
function sceneById(sceneId) { return currentContent()?.scenes?.find(scene => scene.id === sceneId) || null; }
function selectedScene() {
  const frame = effectiveFrame();
  return sceneById(state.selectedSceneId || frame?.sceneId || currentContent()?.startScene);
}

async function touchProject({ modified = true } = {}) {
  if (!state.project) return;
  if (modified) state.project.updatedAt = Domain.now();
  state.project.lastOpenedAt = state.project.lastOpenedAt || Domain.now();
  await DB.put('projects', state.project);
}

async function rememberProjectLocation(route = state.route) {
  if (!state.project || route === 'library') return;
  state.project.lastRoute = route;
  state.project.lastFragmentId = state.selectedFragmentId || state.project.lastFragmentId || null;
  state.project.lastSceneId = state.selectedSceneId || state.project.lastSceneId || null;
  state.project.lastOpenedAt = Domain.now();
  await DB.put('projects', state.project);
}

async function loadCollections() {
  state.projects = (await DB.getAll('projects')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  state.storage = await DB.storageEstimate();
}

async function ensureBuiltinProjects() {
  const builtins = [
    { file: './novel.json', stableId: 'poslednyaya-podacha', aliases: ['poslednyaya-podacha-heartline-branching2-20260808'], sourceType: 'builtin-poslednyaya-podacha' },
    { file: './moon-oath.json', stableId: 'moon_oath', aliases: [], sourceType: 'builtin-moon-oath' }
  ];
  const projects = await DB.getAll('projects');

  for (const builtin of builtins) {
    let response;
    try { response = await fetch(builtin.file, { cache: 'no-store' }); }
    catch (error) { console.warn(`Не удалось загрузить встроенный проект ${builtin.file}`, error); continue; }
    if (!response.ok) { console.warn(`Встроенный проект недоступен: ${builtin.file}`); continue; }

    const content = parser.normalizeNovel(await response.json());
    const sourceVersion = content.contentVersion || `builtin-${window.HEARTLINE_BUILD || 'current'}`;
    let project = projects.find(item => item.projectId === builtin.stableId)
      || projects.find(item => builtin.aliases.includes(item.projectId))
      || projects.find(item => item.builtin && item.title === content.title)
      || null;
    const projectId = project?.projectId || builtin.stableId;
    content.id = projectId;
    const versionId = `${projectId}::builtin-${Domain.slug(sourceVersion)}`;
    const existingVersion = await DB.get('versions', versionId);

    if (!project) {
      const createdAt = Domain.now();
      const validation = parser.validateNovel(content);
      project = {
        projectId,
        title: content.title,
        activeVersionId: versionId,
        createdAt,
        updatedAt: createdAt,
        builtin: true,
        builtinSourceVersion: sourceVersion,
        lastRoute: 'reader'
      };
      const version = {
        versionId, projectId, label: sourceVersion, parentVersionId: null,
        sourceType: builtin.sourceType, createdAt, updatedAt: createdAt, content,
        validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, stats: validation.stats }
      };
      await DB.put('projects', project);
      await DB.put('versions', version);
      await DB.put('workspaceDrafts', { projectId, baseVersionId: versionId, textEdits: {}, selectedFragmentId: null, selectedSceneId: content.startScene, undoStack: [], redoStack: [], dirty: false, updatedAt: createdAt });
      await DB.ensureVisualAssignments(projectId, DB.versionScope(versionId), content);
      await DB.ensureVisualAssignments(projectId, DB.workspaceScope(projectId), content);
      await DB.put('sessions', createSession(projectId, versionId, content));
      projects.push(project);
      continue;
    }

    // Do nothing if this exact built-in edition has already been activated.
    if (project.builtinSourceVersion === sourceVersion && existingVersion) continue;

    const oldVersion = await DB.get('versions', project.activeVersionId);
    const oldWorkspace = await DB.get('workspaceDrafts', projectId);
    const oldWorkspaceScope = DB.workspaceScope(projectId);
    const oldAssignments = await DB.getAllByIndex('visualAssignments', 'scopeId', oldWorkspaceScope);
    const oldByFragment = new Map(oldAssignments.map(item => [item.fragmentId, item]));

    // Preserve unsaved human text work as a real version before switching the built-in source.
    let parentVersionId = project.activeVersionId || null;
    if (oldVersion?.content && oldWorkspace?.dirty && Object.keys(oldWorkspace.textEdits || {}).length) {
      const stamp = Date.now().toString(36);
      const autosaveId = `${projectId}::autosave-before-${Domain.slug(sourceVersion)}-${stamp}`;
      const autosaveContent = Domain.applyTextEditsToContent(oldVersion.content, oldWorkspace.textEdits || {});
      const autosaveValidation = parser.validateNovel(autosaveContent);
      await DB.put('versions', {
        versionId: autosaveId, projectId, label: `Автосохранение перед ${sourceVersion}`,
        parentVersionId: oldVersion.versionId, sourceType: 'builtin-upgrade-autosave', note: 'Создано автоматически перед обновлением встроенного сценария.',
        createdAt: Domain.now(), updatedAt: Domain.now(), content: autosaveContent,
        validation: { ok: autosaveValidation.ok, errors: autosaveValidation.errors, warnings: autosaveValidation.warnings, stats: autosaveValidation.stats }
      });
      await DB.cloneVisualScope(projectId, oldWorkspaceScope, DB.versionScope(autosaveId));
      parentVersionId = autosaveId;
    }

    if (!existingVersion) {
      const validation = parser.validateNovel(content);
      await DB.put('versions', {
        versionId, projectId, label: sourceVersion, parentVersionId,
        sourceType: `${builtin.sourceType}-update`, createdAt: Domain.now(), updatedAt: Domain.now(), content,
        validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, stats: validation.stats }
      });
    }

    // Build fresh visual scopes, then carry over visual work where Fragment IDs survived the source update.
    await DB.deleteByIndex('visualAssignments', 'scopeId', DB.versionScope(versionId));
    await DB.deleteByIndex('visualAssignments', 'scopeId', oldWorkspaceScope);
    let workspaceAssignments = await DB.ensureVisualAssignments(projectId, oldWorkspaceScope, content);
    workspaceAssignments = workspaceAssignments.map(item => {
      const previous = oldByFragment.get(item.fragmentId);
      if (!previous?.assetId) return item;
      return {
        ...item,
        assetId: previous.assetId,
        fit: previous.fit || item.fit,
        focalPoint: previous.focalPoint || item.focalPoint,
        zoom: previous.zoom || item.zoom,
        overlayOpacity: previous.overlayOpacity ?? item.overlayOpacity,
        deviceOverrides: Domain.clone(previous.deviceOverrides || {}),
        status: previous.status === 'approved' ? 'needs-review' : (previous.status || 'draft'),
        updatedAt: Domain.now()
      };
    });
    for (let index = 0; index < workspaceAssignments.length; index += 500) await DB.putMany('visualAssignments', workspaceAssignments.slice(index, index + 500));
    await DB.cloneVisualScope(projectId, oldWorkspaceScope, DB.versionScope(versionId));

    const frameIds = new Set(Domain.flattenFrames(content).map(frame => frame.fragmentId));
    const sourceReviews = await DB.getAllByIndex('reviews', 'projectId', projectId);
    for (const review of sourceReviews) {
      if (review.fragmentId && !frameIds.has(review.fragmentId) && !Domain.CLOSED_REVIEW_STATUSES.has(review.status)) {
        review.status = 'Архив';
        review.archivedReason = `Фрагмент отсутствует в ${sourceVersion}`;
        review.updatedAt = Domain.now();
        await DB.put('reviews', review);
      }
    }
    const selectedFragmentId = frameIds.has(oldWorkspace?.selectedFragmentId) ? oldWorkspace.selectedFragmentId : null;
    const selectedSceneId = content.scenes.some(scene => scene.id === oldWorkspace?.selectedSceneId) ? oldWorkspace.selectedSceneId : content.startScene;
    await DB.put('workspaceDrafts', {
      projectId, baseVersionId: versionId, textEdits: {}, selectedFragmentId, selectedSceneId,
      undoStack: [], redoStack: [], dirty: false, updatedAt: Domain.now()
    });
    await DB.put('sessions', createSession(projectId, versionId, content));

    project.title = content.title;
    project.activeVersionId = versionId;
    project.builtin = true;
    project.builtinSourceVersion = sourceVersion;
    project.statistics = null;
    project.updatedAt = Domain.now();
    project.lastFragmentId = selectedFragmentId;
    project.lastSceneId = selectedSceneId;
    await DB.put('projects', project);
  }
}
async function openProject(projectId, { route = null } = {}) {
  const project = await DB.get('projects', projectId);
  if (!project) throw new Error('Проект не найден');
  state.project = project;
  state.versions = (await DB.getAllByIndex('versions', 'projectId', projectId)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  state.version = await DB.get('versions', project.activeVersionId) || state.versions[0];
  if (!state.version) throw new Error('У проекта нет версии сценария');
  let workspace = await DB.get('workspaceDrafts', projectId);
  if (!workspace || workspace.baseVersionId !== state.version.versionId) {
    workspace = { projectId, baseVersionId: state.version.versionId, textEdits: {}, selectedFragmentId: null, selectedSceneId: state.version.content.startScene, undoStack: [], redoStack: [], dirty: false, updatedAt: Domain.now() };
    await DB.cloneVisualScope(projectId, DB.versionScope(state.version.versionId), DB.workspaceScope(projectId));
    await DB.put('workspaceDrafts', workspace);
  }
  state.workspace = workspace;
  state.assignments = await DB.ensureVisualAssignments(projectId, DB.workspaceScope(projectId), state.version.content);
  state.assignmentMap = new Map(state.assignments.map(item => [item.fragmentId, item]));
  state.reviews = await DB.getAllByIndex('reviews', 'projectId', projectId);
  state.assets = await DB.getAllByIndex('assets', 'projectId', projectId);
  state.assetMap = new Map(state.assets.map(asset => [asset.assetId, asset]));
  state.selectedFragmentId = workspace.selectedFragmentId || project.lastFragmentId || null;
  state.selectedSceneId = workspace.selectedSceneId || project.lastSceneId || state.version.content.startScene;
  let session = (await DB.getAllByIndex('sessions', 'versionId', state.version.versionId)).find(item => item.sessionId === `session:${projectId}:${state.version.versionId}`);
  if (!session) {
    session = createSession(projectId, state.version.versionId, state.version.content);
    await DB.put('sessions', session);
  }
  state.session = session;
  state.engine = new StoryEngine(state.version.content, state.session);
  if (!state.selectedFragmentId) {
    if (!state.engine.currentEntry()) state.engine.advance();
    const entry = state.engine.currentEntry();
    state.selectedFragmentId = entry?.fragmentId || Domain.flattenFrames(state.version.content)[0]?.fragmentId || null;
  }
  state.directFragmentId = null;
  state.project.lastOpenedAt = Domain.now();
  await DB.put('projects', state.project);
  await persistWorkspaceSelection();
  const targetRoute = route || state.project.lastRoute || 'reader';
  await setRoute(targetRoute);
}

async function refreshProjectData({ keepSelection = true } = {}) {
  if (!state.project) return;
  const selected = keepSelection ? state.selectedFragmentId : null;
  const projectId = state.project.projectId;
  state.project = await DB.get('projects', projectId);
  state.versions = (await DB.getAllByIndex('versions', 'projectId', projectId)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  state.version = await DB.get('versions', state.project.activeVersionId);
  state.workspace = await DB.get('workspaceDrafts', projectId);
  state.assignments = await DB.getAllByIndex('visualAssignments', 'scopeId', workspaceScope());
  state.assignmentMap = new Map(state.assignments.map(item => [item.fragmentId, item]));
  state.reviews = await DB.getAllByIndex('reviews', 'projectId', projectId);
  state.assets = await DB.getAllByIndex('assets', 'projectId', projectId);
  state.assetMap = new Map(state.assets.map(asset => [asset.assetId, asset]));
  state.selectedFragmentId = selected || state.workspace.selectedFragmentId || currentFrames()[0]?.fragmentId || null;
}

async function persistWorkspaceSelection() {
  if (!state.workspace) return;
  const frame = effectiveFrame();
  state.workspace.selectedFragmentId = state.selectedFragmentId;
  state.workspace.selectedSceneId = frame?.sceneId || state.selectedSceneId;
  state.workspace.updatedAt = Domain.now();
  await DB.put('workspaceDrafts', state.workspace);
  if (state.project) {
    state.project.lastFragmentId = state.selectedFragmentId || state.project.lastFragmentId || null;
    state.project.lastSceneId = state.workspace.selectedSceneId || state.project.lastSceneId || null;
    state.project.lastOpenedAt = Domain.now();
    await DB.put('projects', state.project);
  }
}

function activeEntry() {
  if (state.directFragmentId) return { kind: 'direct', fragmentId: state.directFragmentId };
  return state.engine?.currentEntry() || null;
}

function syncSelectedWithEngine() {
  const entry = activeEntry();
  if (entry?.fragmentId && !String(entry.fragmentId).startsWith('END_')) {
    state.selectedFragmentId = entry.fragmentId;
    const frame = effectiveFrame();
    state.selectedSceneId = frame?.sceneId || state.selectedSceneId;
  }
}

async function saveSession() {
  if (!state.session) return;
  state.session.updatedAt = Domain.now();
  await DB.put('sessions', state.session);
}

async function selectFragment(fragmentId, { route = null, direct = true } = {}) {
  if (!Domain.getFrameRef(currentContent(), fragmentId)) return;
  state.selectedFragmentId = fragmentId;
  state.directFragmentId = direct ? fragmentId : null;
  const frame = effectiveFrame();
  state.selectedSceneId = frame?.sceneId || state.selectedSceneId;
  await persistWorkspaceSelection();
  if (route) await setRoute(route);
  else if (state.route === 'reader' && $('readerShell')) await refreshReaderContent({ resetScroll: true });
  else await render();
}

async function changeText(fragmentId, text) {
  const ref = Domain.getFrameRef(currentContent(), fragmentId);
  if (!ref) return;
  const before = Object.prototype.hasOwnProperty.call(state.workspace.textEdits || {}, fragmentId) ? state.workspace.textEdits[fragmentId] : Domain.sourceText(ref.step);
  if (before === text) return;
  state.workspace = Domain.recordHistory(state.workspace, { kind: 'text', fragmentId, before, after: text });
  state.workspace.textEdits = { ...(state.workspace.textEdits || {}), [fragmentId]: text };
  await DB.put('workspaceDrafts', state.workspace);
  const assignment = currentAssignment(fragmentId);
  if (assignment?.status === 'approved') {
    const updated = Domain.invalidateApprovedVisual(assignment);
    await DB.put('visualAssignments', updated);
    state.assignmentMap.set(fragmentId, updated);
    const assignmentIndex = state.assignments.findIndex(item => item.fragmentId === fragmentId);
    if (assignmentIndex >= 0) state.assignments[assignmentIndex] = updated;
  }
  await DB.put('changeEvents', { eventId: Domain.uid('change'), projectId: state.project.projectId, fragmentId, kind: 'text', before, after: text, createdAt: Domain.now() });
  await touchProject();
  toast('Текст сохранён. Утверждённый визуал переведён в проверку.');
  await refreshActiveRoute({ resetReaderScroll: false });
}

async function applyAssignmentChange(fragmentId, after, historyLabel = 'visual') {
  const before = Domain.clone(currentAssignment(fragmentId));
  state.workspace = Domain.recordHistory(state.workspace, { kind: 'visual', fragmentId, before, after: Domain.clone(after), label: historyLabel });
  await DB.put('workspaceDrafts', state.workspace);
  await DB.put('visualAssignments', after);
  state.assignmentMap.set(fragmentId, after);
  const index = state.assignments.findIndex(item => item.fragmentId === fragmentId);
  if (index >= 0) state.assignments[index] = after; else state.assignments.push(after);
  await DB.put('changeEvents', { eventId: Domain.uid('change'), projectId: state.project.projectId, fragmentId, kind: 'visual', before, after, createdAt: Domain.now() });
  await touchProject();
}

async function undo() {
  const stack = state.workspace?.undoStack || [];
  const event = stack[stack.length - 1];
  if (!event) return toast('Нечего отменять');
  state.workspace.undoStack = stack.slice(0, -1);
  state.workspace.redoStack = [...(state.workspace.redoStack || []), event].slice(-100);
  if (event.kind === 'text') {
    const source = Domain.sourceText(Domain.getFrameRef(currentContent(), event.fragmentId)?.step);
    if (event.before === source) delete state.workspace.textEdits[event.fragmentId]; else state.workspace.textEdits[event.fragmentId] = event.before;
  } else if (event.kind === 'visual') {
    await DB.put('visualAssignments', event.before);
    state.assignmentMap.set(event.fragmentId, event.before);
  }
  state.workspace.updatedAt = Domain.now();
  await DB.put('workspaceDrafts', state.workspace);
  toast('Изменение отменено');
  await refreshActiveRoute({ resetReaderScroll: false });
}

async function redo() {
  const stack = state.workspace?.redoStack || [];
  const event = stack[stack.length - 1];
  if (!event) return toast('Нечего повторять');
  state.workspace.redoStack = stack.slice(0, -1);
  state.workspace.undoStack = [...(state.workspace.undoStack || []), event].slice(-100);
  if (event.kind === 'text') state.workspace.textEdits[event.fragmentId] = event.after;
  else if (event.kind === 'visual') { await DB.put('visualAssignments', event.after); state.assignmentMap.set(event.fragmentId, event.after); }
  state.workspace.updatedAt = Domain.now();
  await DB.put('workspaceDrafts', state.workspace);
  toast('Изменение повторено');
  await refreshActiveRoute({ resetReaderScroll: false });
}

function sceneFrames(scene) {
  const ids = new Set();
  (function walk(steps) {
    for (const step of steps || []) {
      if (step.type !== 'tech') ids.add(step.fragmentId);
      if (step.type === 'choice') for (const option of step.options || []) walk(option.steps || []);
    }
  })(scene?.steps || []);
  return currentFrames().filter(frame => ids.has(frame.fragmentId));
}

function captureSelection() {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const element = (selection.getRangeAt(0).commonAncestorContainer.nodeType === 1 ? selection.getRangeAt(0).commonAncestorContainer : selection.getRangeAt(0).commonAncestorContainer.parentElement)?.closest?.('[data-frame-text]');
  if (!element) return;
  const text = selection.toString().trim();
  if (!text) return;
  state.selection = { fragmentId: element.dataset.frameText, quotedText: text, at: Date.now() };
}

function openReviewForm({ fragmentId = state.selectedFragmentId, targetType = 'text', anchor = null } = {}) {
  const frame = effectiveFrame(fragmentId);
  if (!frame) return;
  const selection = state.selection?.fragmentId === fragmentId && Date.now() - state.selection.at < 20000 ? state.selection : null;
  const categories = targetType === 'image'
    ? ['Композиция', 'Кадрирование', 'Персонаж', 'Эмоция', 'Поза', 'Костюм', 'Фон', 'Свет', 'Стиль', 'Читаемость текста', 'Другое']
    : ['Стиль', 'Диалог', 'Логика', 'Темп', 'Персонаж', 'Повтор', 'Опечатка', 'Другое'];
  openModal({
    kicker: targetType === 'image' ? 'ВИЗУАЛЬНАЯ ВЫЧИТКА' : 'ТЕКСТОВАЯ ВЫЧИТКА',
    title: targetType === 'image' ? 'Замечание к изображению' : 'Добавить замечание',
    body: `${selection && targetType === 'text' ? `<blockquote class="review-quote">${Domain.escapeHtml(selection.quotedText)}</blockquote>` : ''}
      ${anchor ? `<p class="muted">Точка на изображении: ${Math.round(anchor.x * 100)}% / ${Math.round(anchor.y * 100)}%</p>` : ''}
      <label class="field"><span>Категория</span><select id="reviewCategory" class="select">${categories.map(category => `<option>${category}</option>`).join('')}</select></label>
      <label class="field"><span>Важность</span><select id="reviewSeverity" class="select"><option value="normal">Обычное</option><option value="critical">Критичное</option></select></label>
      <label class="field"><span>Комментарий</span><textarea id="reviewComment" class="textarea" placeholder="Что нужно изменить и почему?"></textarea></label>`,
    footer: `<button id="cancelReview" class="button secondary">Отмена</button><button id="saveReview" class="button primary">Сохранить</button>`
  });
  $('cancelReview').onclick = closeModal;
  $('saveReview').onclick = async () => {
    const comment = $('reviewComment').value.trim();
    if (!comment) return toast('Добавьте комментарий');
    const review = {
      reviewId: Domain.uid('review'), projectId: state.project.projectId, versionId: state.version.versionId,
      targetType, fragmentId, visualId: currentAssignment(fragmentId)?.assignmentId || null,
      quotedText: targetType === 'text' ? selection?.quotedText || null : null,
      anchor: targetType === 'image' ? anchor : null,
      category: $('reviewCategory').value, severity: $('reviewSeverity').value, comment,
      status: 'Открыто', createdAt: Domain.now(), updatedAt: Domain.now()
    };
    await DB.put('reviews', review);
    state.reviews.push(review);
    await touchProject();
    closeModal();
    toast('Замечание сохранено');
    await refreshActiveRoute({ resetReaderScroll: false });
  };
}

async function updateReviewStatus(reviewId, status, { rerender = true } = {}) {
  const review = state.reviews.find(item => item.reviewId === reviewId);
  if (!review) return;
  review.status = status;
  review.updatedAt = Domain.now();
  await DB.put('reviews', review);
  await touchProject();
  if (rerender) await refreshActiveRoute({ resetReaderScroll: false });
}

async function hydrateImages(root = document) {
  const elements = [...root.querySelectorAll('[data-asset-src]')];
  await Promise.all(elements.map(async element => {
    const assetId = element.dataset.assetSrc;
    if (!assetId) return;
    const url = await Assets.assetObjectUrl(assetId, { thumbnail: element.dataset.thumbnail === 'true' });
    if (!url) return;
    if (element.tagName === 'IMG') element.src = url;
    else element.style.backgroundImage = `url("${url}")`;
  }));
}

function metricsHtml(metrics) {
  return `
    <div class="metric"><strong>${metrics.frames}</strong><span>кадров</span></div>
    <div class="metric"><strong>${metrics.assignedPercent}%</strong><span>изображения назначены</span></div>
    <div class="metric"><strong>${metrics.approvedPercent}%</strong><span>визуалы утверждены</span></div>
    <div class="metric"><strong>${metrics.missing}</strong><span>без изображения</span></div>
    <div class="metric"><strong>${metrics.needsReview}</strong><span>требуют проверки</span></div>
    <div class="metric"><strong>${metrics.openReviews}</strong><span>открытых замечаний</span></div>`;
}


function openMobileMoreMenu() {
  openModal({ kicker: 'НАВИГАЦИЯ', title: 'Ещё', body: `<div class="mobile-more-grid"><button class="button secondary" data-more-route="assets">Изображения</button><button class="button secondary" data-more-route="reviews">Замечания</button><button class="button secondary" data-more-route="versions">Версии</button><button class="button secondary" data-more-route="gpt">GPT</button><button class="button secondary" data-more-route="graph">Граф</button><button class="button secondary" data-more-route="export">Экспорт</button></div>`, footer: '<button id="closeMoreMenu" class="button primary">Готово</button>' });
  $('closeMoreMenu').onclick = closeModal;
  $('modalBody').querySelectorAll('[data-more-route]').forEach(button => button.onclick = async () => { const route = button.dataset.moreRoute; closeModal(); await setRoute(route); });
}

function applyReaderPreferences() {
  const shell = $('readerShell'); if (!shell) return;
  shell.style.setProperty('--reader-text-scale', String(state.readerTextScale));
  shell.style.setProperty('--reader-line-height', String(state.readerLineHeight));
  shell.style.setProperty('--reader-column-width', `${state.readerColumnWidth}px`);
  shell.classList.toggle('reader-font-sans', state.readerFont === 'sans');
  shell.classList.toggle('reader-focus', Boolean(state.readerFocus));
}

function projectMetricIcon(kind) {
  const paths = {
    frames: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 16l4-4 3 3 2-2 3 3"/><circle cx="8" cy="9" r="1.5"/>',
    choices: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 5h3a4 4 0 014 4v0M8 5h3a4 4 0 014 4v4a4 4 0 003 4"/>',
    endings: '<path d="M12 21s-7-4.35-7-10a4 4 0 017-2.65A4 4 0 0119 11c0 5.65-7 10-7 10z"/>',
    branches: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 12h3a4 4 0 004-4V5M10 12h1a4 4 0 014 4v3"/>',
    words: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    unique: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 010 18V3z"/>'
  };
  return `<svg class="project-stat-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[kind] || paths.frames}</svg>`;
}

function routeLabel(route) {
  return ({ reader: 'Читать', storyboard: 'Сториборд', assets: 'Изображения', preview: 'Превью', reviews: 'Замечания', versions: 'Версии', gpt: 'GPT', graph: 'Граф', export: 'Экспорт' })[route] || 'Читать';
}

function projectCoverPlaceholder(title) {
  const safe = Domain.escapeHtml(title || 'HEARTLINE');
  return `<div class="project-cover-placeholder"><span>HEARTLINE</span><strong>${safe}</strong></div>`;
}

async function hydrateLibraryCovers(root = view) {
  const nodes = [...root.querySelectorAll('[data-cover-asset]')];
  await Promise.all(nodes.map(async node => {
    const assetId = node.dataset.coverAsset;
    if (!assetId) return;
    const url = await Assets.assetObjectUrl(assetId, { thumbnail: false });
    if (url) node.src = url;
  }));
}

async function projectLibrarySnapshot(project) {
  try {
    const [version, workspace, assignments, reviews] = await Promise.all([
      DB.get('versions', project.activeVersionId),
      DB.get('workspaceDrafts', project.projectId),
      DB.getAllByIndex('visualAssignments', 'scopeId', DB.workspaceScope(project.projectId)),
      DB.getAllByIndex('reviews', 'projectId', project.projectId)
    ]);
    if (!version?.content) return null;
    const effectiveWorkspace = workspace || { textEdits: {} };
    const cacheKey = ProjectStats.statisticsCacheKey(version.versionId, effectiveWorkspace.textEdits || {});
    let statistics = project.statistics?.cacheKey === cacheKey ? project.statistics.data : null;
    if (!statistics) {
      statistics = ProjectStats.calculateProjectStatistics(version.content, effectiveWorkspace.textEdits || {});
      project.statistics = { cacheKey, data: statistics, calculatedAt: Domain.now() };
      await DB.put('projects', project);
    }
    const production = Domain.projectMetrics(version.content, effectiveWorkspace, assignments, reviews);
    return {
      version,
      workspace: effectiveWorkspace,
      statistics,
      production,
      validation: version.validation || parser.validateNovel(version.content)
    };
  } catch (error) {
    console.warn('Project statistics:', project.projectId, error);
    return null;
  }
}

function projectStatTile(kind, label, value, secondary = '', title = '') {
  return `<div class="project-stat-tile" ${title ? `title="${Domain.escapeHtml(title)}"` : ''}>
    <div class="project-stat-label">${projectMetricIcon(kind)}<span>${Domain.escapeHtml(label)}</span></div>
    <strong>${value}</strong>
    ${secondary ? `<small>${secondary}</small>` : '<small>&nbsp;</small>'}
  </div>`;
}

function projectCardHtml(project, snapshot) {
  const stats = snapshot?.statistics;
  const prod = snapshot?.production;
  const validation = snapshot?.validation;
  const reading = stats?.readingTime ? `≈ ${stats.readingTime.min}–${stats.readingTime.max} мин` : '≈ — мин';
  const choiceSecondary = stats ? `${ProjectStats.formatInteger(stats.choices.significant)} значимых` : '—';
  const endingSecondary = stats?.endings?.total
    ? (stats.endings.secret ? `${ProjectStats.formatInteger(stats.endings.main || 0)} осн. / ${ProjectStats.formatInteger(stats.endings.secret)} секр.` : 'по структуре')
    : '—';
  const uniqueTitle = stats ? `Общий контент: ${100 - stats.uniqueContentPercent}% · уникальный: ${stats.uniqueContentPercent}%` : '';
  const continueRoute = project.lastRoute && project.lastRoute !== 'library' ? project.lastRoute : 'reader';
  const cover = project.coverAssetId
    ? `<img class="project-cover-image" data-cover-asset="${Domain.escapeHtml(project.coverAssetId)}" alt="Обложка ${Domain.escapeHtml(project.title)}">`
    : projectCoverPlaceholder(project.title);
  return `<article class="card project-card project-card-rich" data-project-card="${Domain.escapeHtml(project.projectId)}" tabindex="0">
    <div class="project-cover">${cover}</div>
    <div class="project-card-rich-body">
      <header class="project-card-rich-head">
        <div><span class="kicker">ПРОЕКТ</span><h2>${Domain.escapeHtml(project.title)}</h2></div>
        <button class="project-menu-button" data-project-menu="${Domain.escapeHtml(project.projectId)}" type="button" aria-label="Меню проекта">•••</button>
      </header>
      <div class="project-version-row">
        <span class="project-version" title="${Domain.escapeHtml(project.activeVersionId)}">${Domain.escapeHtml(project.activeVersionId)}</span>
        <time>${Domain.formatDate(project.updatedAt || project.createdAt)}</time>
      </div>
      <div class="project-summary-row">
        <span>${reading}</span><i></i><span>${stats ? ProjectStats.formatInteger(stats.chapters) : '—'} глав</span><i></i><span>${stats ? ProjectStats.formatInteger(stats.scenes) : '—'} сцен</span>
        ${validation && validation.ok === false ? '<span class="status-badge missing">Структура требует проверки</span>' : ''}
      </div>
      <div class="project-stats-grid">
        ${projectStatTile('frames', 'Кадры', stats ? ProjectStats.formatInteger(stats.frames) : '—')}
        ${projectStatTile('choices', 'Выборы', stats ? ProjectStats.formatInteger(stats.choices.options) : '—', choiceSecondary, stats ? `Choice-нод: ${stats.choices.choiceNodes} · косметических: ${stats.choices.flavor}` : '')}
        ${projectStatTile('endings', 'Концовки', stats ? ProjectStats.formatInteger(stats.endings.total) : '—', endingSecondary)}
        ${projectStatTile('branches', 'Ветвления', stats ? ProjectStats.formatInteger(stats.branches) : '—', 'сюжетных точек')}
        ${projectStatTile('words', 'Слов в сценарии', stats ? ProjectStats.formatInteger(stats.words) : '—')}
        ${projectStatTile('unique', 'Уникальный контент', stats ? `${stats.uniqueContentPercent}%` : '—', 'от всего объёма', uniqueTitle)}
      </div>
      ${prod ? `<div class="project-production-row"><div><span>Визуалы</span><b>${prod.assignedPercent}%</b></div><div class="progress"><span style="width:${prod.assignedPercent}%"></span></div><div><span>Замечания</span><b>${prod.openReviews}</b></div></div>` : ''}
      <footer class="project-card-rich-foot">
        <span class="muted">Продолжить: ${Domain.escapeHtml(routeLabel(continueRoute))}</span>
        <button class="button primary" data-open-project="${Domain.escapeHtml(project.projectId)}">Продолжить</button>
      </footer>
    </div>
  </article>`;
}

async function handleProjectCover(file) {
  const projectId = $('coverInput')?.dataset.projectId;
  if (!file || !projectId) return;
  try {
    toast('Загружаю обложку…', 5000);
    const result = await Assets.importAsset(projectId, file, { source: 'project-cover' });
    const project = await DB.get('projects', projectId);
    if (!project) throw new Error('Проект не найден');
    project.coverAssetId = result.asset.assetId;
    project.updatedAt = Domain.now();
    await DB.put('projects', project);
    await loadCollections();
    toast('Обложка проекта обновлена');
    await renderLibrary();
  } catch (error) { toast(error.message, 5000); }
}

async function renameLibraryProject(projectId) {
  const project = await DB.get('projects', projectId);
  if (!project) return;
  const title = prompt('Название проекта', project.title || '');
  if (!title?.trim()) return;
  project.title = title.trim();
  project.updatedAt = Domain.now();
  await DB.put('projects', project);
  await loadCollections();
  renderLibrary();
}

async function archiveLibraryProject(projectId, archived) {
  const project = await DB.get('projects', projectId);
  if (!project) return;
  project.archived = archived;
  project.updatedAt = Domain.now();
  await DB.put('projects', project);
  await loadCollections();
  renderLibrary();
}

async function duplicateLibraryProject(projectId) {
  const sourceProject = await DB.get('projects', projectId);
  const sourceVersion = sourceProject ? await DB.get('versions', sourceProject.activeVersionId) : null;
  const sourceWorkspace = sourceProject ? await DB.get('workspaceDrafts', projectId) : null;
  if (!sourceProject || !sourceVersion) return toast('Не удалось прочитать проект');
  toast('Создаю копию проекта…', 7000);
  const suffix = Date.now().toString(36);
  const newProjectId = `${Domain.slug(sourceProject.title)}-copy-${suffix}`;
  const newVersionId = `${newProjectId}::copy-${suffix}`;
  const content = Domain.applyTextEditsToContent(sourceVersion.content, sourceWorkspace?.textEdits || {});
  content.id = newProjectId;
  const now = Domain.now();
  const project = { projectId: newProjectId, title: `${sourceProject.title} — копия`, activeVersionId: newVersionId, createdAt: now, updatedAt: now, lastRoute: 'reader' };
  const version = { versionId: newVersionId, projectId: newProjectId, label: 'Копия проекта', parentVersionId: null, sourceType: 'duplicate-project', createdAt: now, updatedAt: now, content, validation: parser.validateNovel(content) };
  await DB.put('projects', project);
  await DB.put('versions', version);
  await DB.put('workspaceDrafts', { projectId: newProjectId, baseVersionId: newVersionId, textEdits: {}, selectedFragmentId: sourceWorkspace?.selectedFragmentId || null, selectedSceneId: sourceWorkspace?.selectedSceneId || content.startScene, undoStack: [], redoStack: [], dirty: false, updatedAt: now });

  const assetMap = new Map();
  const sourceAssets = await DB.getAllByIndex('assets', 'projectId', projectId);
  for (const asset of sourceAssets) {
    if (!asset.blob) continue;
    const file = new File([asset.blob], asset.name || 'asset', { type: asset.mimeType || asset.blob.type || 'image/webp' });
    const imported = await Assets.importAsset(newProjectId, file, { source: 'project-duplicate' });
    assetMap.set(asset.assetId, imported.asset.assetId);
  }

  const sourceAssignments = await DB.getAllByIndex('visualAssignments', 'scopeId', DB.workspaceScope(projectId));
  const newScope = DB.workspaceScope(newProjectId);
  const copiedAssignments = sourceAssignments.map(item => ({ ...Domain.clone(item), projectId: newProjectId, scopeId: newScope, assignmentId: DB.visualAssignmentId(newScope, item.fragmentId), assetId: assetMap.get(item.assetId) || null, status: item.assetId && assetMap.get(item.assetId) ? (item.status || 'draft') : 'missing', updatedAt: now }));
  for (let i = 0; i < copiedAssignments.length; i += 500) await DB.putMany('visualAssignments', copiedAssignments.slice(i, i + 500));
  await DB.ensureVisualAssignments(newProjectId, newScope, content);
  await DB.cloneVisualScope(newProjectId, newScope, DB.versionScope(newVersionId));

  const sourceReviews = await DB.getAllByIndex('reviews', 'projectId', projectId);
  if (sourceReviews.length) {
    await DB.putMany('reviews', sourceReviews.map(review => ({ ...Domain.clone(review), reviewId: Domain.uid('review'), projectId: newProjectId, versionId: newVersionId, visualId: review.fragmentId ? DB.visualAssignmentId(newScope, review.fragmentId) : null, createdAt: now, updatedAt: now })));
  }
  project.coverAssetId = assetMap.get(sourceProject.coverAssetId) || null;
  await DB.put('projects', project);
  await loadCollections();
  toast('Копия проекта создана');
  renderLibrary();
}

async function deleteLibraryProject(projectId) {
  const project = await DB.get('projects', projectId);
  if (!project) return;
  if (!confirm(`Удалить проект «${project.title}» и все его локальные данные? Это действие нельзя отменить.`)) return;
  const assets = await DB.getAllByIndex('assets', 'projectId', projectId);
  for (const asset of assets) {
    await DB.del('assetThumbnails', asset.assetId);
    await DB.del('assets', asset.assetId);
    Assets.revokeAssetUrl(asset.assetId);
  }
  for (const [store, index] of [
    ['versions','projectId'], ['sessions','projectId'], ['reviews','projectId'], ['visualAssignments','projectId'],
    ['gptCandidates','projectId'], ['gptCycles','projectId'], ['changeEvents','projectId'], ['runtimeBuilds','projectId']
  ]) await DB.deleteByIndex(store, index, projectId);
  await DB.del('workspaceDrafts', projectId);
  await DB.del('projects', projectId);
  if (state.project?.projectId === projectId) {
    state.project = null; state.version = null; state.workspace = null; state.session = null; state.engine = null;
  }
  await loadCollections();
  toast('Проект удалён');
  renderLibrary();
}

async function openLibraryProjectMenu(projectId) {
  const project = await DB.get('projects', projectId);
  if (!project) return;
  openModal({
    kicker: 'ПРОЕКТ',
    title: project.title,
    body: `<div class="project-menu-grid">
      <button class="button primary" data-project-action="open">Открыть проект</button>
      <button class="button secondary" data-project-action="cover">Заменить обложку</button>
      ${project.coverAssetId ? '<button class="button secondary" data-project-action="remove-cover">Убрать обложку</button>' : ''}
      <button class="button secondary" data-project-action="rename">Переименовать</button>
      <button class="button secondary" data-project-action="duplicate">Дублировать</button>
      <button class="button secondary" data-project-action="export">Экспорт Project ZIP</button>
      <button class="button secondary" data-project-action="archive">${project.archived ? 'Вернуть из архива' : 'Архивировать'}</button>
      <button class="button danger" data-project-action="delete">Удалить проект</button>
    </div>`,
    footer: '<button id="projectMenuClose" class="button secondary">Закрыть</button>'
  });
  $('projectMenuClose').onclick = closeModal;
  $('modalBody').querySelectorAll('[data-project-action]').forEach(button => button.onclick = async () => {
    const action = button.dataset.projectAction;
    if (action === 'open') { closeModal(); return openProject(projectId); }
    if (action === 'cover') { closeModal(); $('coverInput').dataset.projectId = projectId; $('coverInput').value = ''; return $('coverInput').click(); }
    if (action === 'remove-cover') { project.coverAssetId = null; project.updatedAt = Domain.now(); await DB.put('projects', project); closeModal(); await loadCollections(); return renderLibrary(); }
    if (action === 'rename') { closeModal(); return renameLibraryProject(projectId); }
    if (action === 'duplicate') { closeModal(); return duplicateLibraryProject(projectId); }
    if (action === 'archive') { closeModal(); return archiveLibraryProject(projectId, !project.archived); }
    if (action === 'delete') { closeModal(); return deleteLibraryProject(projectId); }
    if (action === 'export') {
      closeModal();
      await openProject(projectId, { route: 'library' });
      await exportProjectZip();
      return renderLibrary();
    }
  });
}

async function renderLibrary() {
  await loadCollections();
  const snapshots = new Map();
  await Promise.all(state.projects.map(async project => snapshots.set(project.projectId, await projectLibrarySnapshot(project))));

  const query = state.libraryQuery.trim().toLowerCase();
  let projects = state.projects.filter(project => {
    if (state.libraryView === 'active' && project.archived) return false;
    if (state.libraryView === 'archived' && !project.archived) return false;
    if (query && !`${project.title || ''} ${project.activeVersionId || ''}`.toLowerCase().includes(query)) return false;
    return true;
  });
  projects = [...projects].sort((a, b) => {
    if (state.librarySort === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
    return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  });

  view.className = 'view';
  view.innerHTML = `<section class="page library-page">
    <header class="page-header"><div><span class="kicker">HEARTLINE EDITOR 3.1</span><h1>Проекты новелл</h1><p>Масштаб истории, интерактивность и состояние производства — до открытия проекта.</p></div><div class="header-actions"><button id="importNovelButton" class="button secondary">Импорт сценария</button><button id="importProjectButton" class="button primary">Импорт Project ZIP</button></div></header>
    <div class="library-toolbar"><input id="librarySearch" class="input" placeholder="Поиск по названию или версии" value="${Domain.escapeHtml(state.libraryQuery)}"><select id="libraryView" class="select"><option value="active">Активные</option><option value="archived">Архив</option><option value="all">Все</option></select><select id="librarySort" class="select"><option value="updated">Сначала изменённые</option><option value="title">По названию</option></select></div>
    <div class="library-sync-note card pad"><div><span class="status-badge draft">Локальный режим</span><strong>Проекты сохраняются в этом браузере.</strong><p>Для переноса на другое устройство используйте Project ZIP. Обложки и статистика входят в локальный проект.</p></div></div>
    <div class="project-list rich-project-list">${projects.map(project => projectCardHtml(project, snapshots.get(project.projectId))).join('')}</div>
    ${projects.length ? '' : '<div class="empty-state"><div><h2>Проекты не найдены</h2><p>Измените поиск или фильтр библиотеки.</p></div></div>'}
  </section>`;
  $('libraryView').value = state.libraryView;
  $('librarySort').value = state.librarySort;
  $('importNovelButton').onclick = () => { $('novelInput').value = ''; $('novelInput').click(); };
  $('importProjectButton').onclick = () => { $('projectImportInput').value = ''; $('projectImportInput').click(); };
  $('librarySearch').oninput = event => {
    state.libraryQuery = event.target.value;
    clearTimeout(state.librarySearchTimer);
    state.librarySearchTimer = setTimeout(async () => {
      await renderLibrary();
      const input = $('librarySearch');
      if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); }
    }, 180);
  };
  $('libraryView').onchange = () => { state.libraryView = $('libraryView').value; renderLibrary(); };
  $('librarySort').onchange = () => { state.librarySort = $('librarySort').value; renderLibrary(); };
  view.querySelectorAll('[data-open-project]').forEach(button => button.onclick = event => { event.stopPropagation(); openProject(button.dataset.openProject); });
  view.querySelectorAll('[data-project-menu]').forEach(button => button.onclick = event => { event.stopPropagation(); openLibraryProjectMenu(button.dataset.projectMenu); });
  view.querySelectorAll('[data-project-card]').forEach(card => {
    card.onclick = event => {
      if (event.target.closest('button,input,select,a')) return;
      openProject(card.dataset.projectCard);
    };
    card.onkeydown = event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target === card) { event.preventDefault(); openProject(card.dataset.projectCard); }
    };
  });
  await hydrateLibraryCovers(view);
}
function sceneTreeStatus(scene) {
  const metrics = Domain.sceneFrameMetrics(currentContent(), scene.id, state.assignments, state.reviews);
  return metrics.missing
    ? '<i class="status-dot danger" title="Есть кадры без изображения"></i>'
    : metrics.needsReview
      ? '<i class="status-dot warn" title="Есть визуалы, требующие проверки"></i>'
      : '<i class="status-dot good" title="Визуалы сцены в порядке"></i>';
}

function sceneDisplayLabel(scene, { compact = false } = {}) {
  const prefix = scene.code || scene.id;
  return compact ? `${prefix} · ${scene.title}` : `${scene.id} · ${scene.title}`;
}

function sceneFamilyInfo(scene, chapterScenes) {
  const code = String(scene.code || '').trim();
  if (code) {
    const child = code.match(/^(\d+\.\d+)([A-Za-zА-Яа-я])$/u);
    if (child) return { key: `code:${child[1]}`, child: true, baseCode: child[1] };
    const hasChildren = chapterScenes.some(other => String(other.code || '').match(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[A-Za-zА-Яа-я]$`, 'u')));
    if (hasChildren) return { key: `code:${code}`, child: false, baseCode: code };
    return { key: `solo:${scene.id}`, child: false, solo: true };
  }

  const id = String(scene.id || '');
  let numberedRoute = id.match(/^(.*_(?:EQUAL|FIRE|MASK|DIRECT|OATH|NETWORK|BREAK))_(\d+)$/i);
  if (numberedRoute) return { key: `id:${numberedRoute[1]}`, child: true, baseId: numberedRoute[1], routeGroup: true };
  const family = id.match(/^((?:CH\d+|OB|CLIM|AM|EP)_SC\d+)(?:_(.+))?$/i);
  if (family) {
    const key = family[1];
    const suffix = family[2] || '';
    const members = chapterScenes.filter(other => String(other.id || '').startsWith(`${key}_`) || other.id === key);
    if (members.length > 1) return { key: `id:${key}`, child: !!suffix, baseId: key, routeGroup: members.some(other => /_(?:EQUAL|FIRE|MASK|DIRECT)(?:_|$)/i.test(other.id)) };
  }
  return { key: `solo:${scene.id}`, child: false, solo: true };
}

function sceneButtonHtml(scene, depth = 0) {
  return `<button class="scene-link scene-link-depth-${depth} ${scene.id === state.selectedSceneId ? 'active' : ''}" data-scene-id="${Domain.escapeHtml(scene.id)}" data-scene-search="${Domain.escapeHtml(`${scene.id} ${scene.code || ''} ${scene.title}`.toLowerCase())}"><span class="scene-link-copy">${Domain.escapeHtml(sceneDisplayLabel(scene, { compact: Boolean(scene.code) }))}</span><span class="scene-status">${sceneTreeStatus(scene)}</span></button>`;
}

function readerSceneTree() {
  const groups = Domain.chapterGroups(currentContent());
  return groups.map(group => {
    const activeChapter = group.scenes.some(scene => scene.id === state.selectedSceneId);
    const families = new Map();
    const order = [];
    for (const scene of group.scenes) {
      const info = sceneFamilyInfo(scene, group.scenes);
      if (!families.has(info.key)) { families.set(info.key, { info, scenes: [] }); order.push(info.key); }
      families.get(info.key).scenes.push(scene);
    }
    const body = order.map(key => {
      const family = families.get(key);
      if (family.info.solo || family.scenes.length === 1) return sceneButtonHtml(family.scenes[0], 0);
      const base = family.scenes.find(scene => (!family.info.baseCode || scene.code === family.info.baseCode) && (!family.info.baseId || scene.id === family.info.baseId)) || null;
      const children = family.scenes.filter(scene => scene !== base);
      const familyActive = family.scenes.some(scene => scene.id === state.selectedSceneId);
      let label;
      if (base) label = sceneDisplayLabel(base, { compact: Boolean(base.code) });
      else if (family.info.routeGroup) {
        const sample = family.scenes[0];
        const sceneNumber = (sample.code || sample.id).match(/(?:SC|\.)(\d+)(?:\D|$)/i)?.[1] || '';
        label = `Сцена ${sceneNumber || ''} · варианты маршрута`.trim();
      } else {
        const sample = family.scenes[0];
        const baseNumber = String(family.info.baseId || '').match(/SC(\d+)/i)?.[1];
        label = sample.code ? `Сцена ${family.info.baseCode}` : baseNumber ? `Сцена ${Number(baseNumber)} · связанные эпизоды` : `Связанные сцены`;
      }
      return `<details class="scene-family" data-scene-family ${familyActive ? 'open' : ''}><summary><span>${Domain.escapeHtml(label)}</span><b>${family.scenes.length}</b></summary><div class="scene-family-body">${base ? sceneButtonHtml(base, 1) : ''}${children.map(scene => sceneButtonHtml(scene, 1)).join('')}</div></details>`;
    }).join('');
    return `<details class="reader-chapter-group" data-reader-chapter ${activeChapter ? 'open' : ''}><summary class="reader-chapter-summary"><span>${Domain.escapeHtml(group.title)}</span><b>${group.scenes.length}</b></summary><div class="reader-chapter-body">${body}</div></details>`;
  }).join('');
}
function isMobileReader() {
  return window.matchMedia?.('(max-width: 820px)').matches ?? window.innerWidth <= 820;
}

function readerContextLimit() {
  if (state.readerContextCount !== 'auto') return Number(state.readerContextCount) || 0;
  return isMobileReader() ? 1 : 2;
}

function readerCurrentHtml() {
  const frame = effectiveFrame();
  if (!frame) return '<div class="empty-state"><div><h2>Кадр не выбран</h2><p>Выберите сцену или начните прохождение.</p></div></div>';
  const frames = currentFrames();
  const index = frames.findIndex(item => item.fragmentId === frame.fragmentId);
  const contextLimit = readerContextLimit();
  const contextItems = contextLimit ? frames.slice(Math.max(0, index - contextLimit), index) : [];
  const context = contextItems.map(item => {
    const ref = Domain.getFrameRef(currentContent(), item.fragmentId);
    return `<div class="context-frame ${ref.step.type}">${Domain.escapeHtml(Domain.effectiveText(ref.step, state.workspace))}</div>`;
  }).join('');
  const entry = activeEntry();
  const selectedOptionId = entry?.kind === 'choice' ? entry.selectedOptionId : null;
  const choiceRef = frame.type === 'choice' ? Domain.getFrameRef(currentContent(), frame.fragmentId)?.step : null;
  const options = frame.type === 'choice' ? `<div class="choice-options">${frame.options.map(option => {
    const rawOption = choiceRef?.options?.find(item => item.id === option.id);
    const available = !rawOption?.condition || state.engine?.evaluateCondition?.(rawOption.condition);
    const conditionNote = rawOption?.condition && !available ? ` · недоступно: ${rawOption.condition}` : '';
    return `<button class="choice-option ${selectedOptionId === option.id ? 'selected' : ''} ${available ? '' : 'unavailable'}" data-choice-option="${Domain.escapeHtml(option.id)}" ${available ? '' : 'disabled'} ${state.directFragmentId ? 'data-direct-choice="true"' : ''}>${Domain.escapeHtml(option.label)}${selectedOptionId === option.id ? ' ✓' : ''}${conditionNote ? `<small>${Domain.escapeHtml(conditionNote)}</small>` : ''}</button>`;
  }).join('')}</div>` : '';
  const noContextClass = contextLimit === 0 ? ' reader-no-context' : '';
  return `<div class="scene-cue"><strong>${Domain.escapeHtml(frame.sceneTitle)}</strong><span>${Domain.escapeHtml(frame.visualPrompt || frame.sceneId)}</span></div>
    <div class="reading-column${noContextClass}"><div class="reader-context-zone">${context || '<span class="reader-context-empty" aria-hidden="true"></span>'}</div><div class="reader-current-zone"><article class="current-frame ${frame.type}"><div class="frame-actions"><button class="mini-button" id="commentCurrent" title="Комментарий" aria-label="Добавить замечание">💬</button><button class="mini-button" id="editCurrent" title="Редактировать" aria-label="Редактировать текст">✎</button></div>${frame.speaker ? `<span class="speaker">${Domain.escapeHtml(frame.speaker)}</span>` : ''}<div class="frame-text" data-frame-text="${Domain.escapeHtml(frame.fragmentId)}">${Domain.escapeHtml(frame.text)}</div>${options}</article></div></div>`;
}

function inspectorFrameTab(frame) {
  return `<section class="inspector-section"><h3>Текст кадра</h3><label class="field"><span>${Domain.textTypeLabel(frame.type)} · ${Domain.escapeHtml(frame.fragmentId)}</span><textarea id="frameTextEditor" class="textarea">${Domain.escapeHtml(frame.text)}</textarea></label><div class="inline-actions"><button id="saveFrameText" class="button primary small">Сохранить текст</button><button id="restoreFrameText" class="button secondary small">Вернуть оригинал</button></div></section>
    <section class="inspector-section"><h3>Навигация</h3><div class="inline-actions"><button id="openStoryboardCurrent" class="button secondary small">Сториборд сцены</button><button id="openPreviewCurrent" class="button secondary small">Мобильное превью</button></div></section>
    <section class="inspector-section"><h3>Статусы</h3><p class="muted">Текст изменён: ${Object.prototype.hasOwnProperty.call(state.workspace.textEdits || {}, frame.fragmentId) ? 'да' : 'нет'}<br>Изображение: ${Domain.statusLabel(frame.assignment?.status || 'missing')}</p></section>`;
}

function inspectorImageTab(frame) {
  const assignment = frame.assignment;
  const asset = frame.asset;
  const focal = assignment?.focalPoint || { x: .5, y: .5 };
  return `<section class="inspector-section"><h3>Изображение кадра</h3><div class="visual-card"><div id="inspectorVisual" class="visual-preview" data-visual-fragment="${Domain.escapeHtml(frame.fragmentId)}">${asset ? `<img data-asset-src="${Domain.escapeHtml(asset.assetId)}" alt="" style="object-position:${Math.round(focal.x * 100)}% ${Math.round(focal.y * 100)}%;transform:scale(${assignment.zoom || 1})"><i class="focal-marker" style="left:${focal.x * 100}%;top:${focal.y * 100}%"></i>` : `<div class="visual-placeholder"><div><strong>Изображение не назначено</strong><p>${Domain.escapeHtml(frame.visualPrompt || '')}</p></div></div>`}</div><div class="visual-card-foot"><span class="status-badge ${assignment?.status || 'missing'}">${Domain.statusLabel(assignment?.status || 'missing')}</span>${asset ? `<small>${asset.width}×${asset.height} · ${Math.round(asset.fileSize / 1024)} КБ</small>` : ''}</div></div><div class="inline-actions" style="margin-top:10px"><button id="replaceFrameAsset" class="button primary small">${asset ? 'Заменить' : 'Добавить'}</button><button id="copyPreviousAsset" class="button secondary small">Как у предыдущего</button>${asset ? '<button id="removeFrameAsset" class="button secondary small">Удалить связь</button>' : ''}</div></section>
    <section class="inspector-section"><h3>Кадрирование</h3><label class="field"><span>Zoom</span><input id="visualZoom" type="range" min="1" max="2.2" step="0.02" value="${assignment?.zoom || 1}"></label><label class="field"><span>Прозрачность панели</span><input id="visualOverlay" type="range" min="0" max="0.35" step="0.01" value="${assignment?.overlayOpacity ?? .12}"></label><label class="field"><span>Статус</span><select id="visualStatus" class="select">${Domain.VISUAL_STATUSES.map(status => `<option value="${status}" ${status === (assignment?.status || 'missing') ? 'selected' : ''}>${Domain.statusLabel(status)}</option>`).join('')}</select></label><button id="saveVisualSettings" class="button primary small">Сохранить визуал</button></section>
    <section class="inspector-section"><h3>Визуальная вычитка</h3><p class="muted">Кликните по изображению, чтобы задать focal point. Shift+клик создаёт точечное замечание.</p><button id="visualReviewButton" class="button secondary small">Добавить замечание к изображению</button></section>`;
}

function reviewCard(review) {
  return `<article class="review-card"><div class="review-card-head"><strong>${Domain.escapeHtml(review.category)}${review.severity === 'critical' ? ' · Критично' : ''}</strong><span class="status-badge ${review.targetType === 'image' ? 'needs-review' : 'draft'}">${Domain.escapeHtml(review.targetType)}</span></div>${review.quotedText ? `<blockquote>${Domain.escapeHtml(review.quotedText)}</blockquote>` : ''}<p>${Domain.escapeHtml(review.comment)}</p><select class="select" data-review-status="${Domain.escapeHtml(review.reviewId)}">${Domain.REVIEW_STATUSES.map(status => `<option ${status === review.status ? 'selected' : ''}>${Domain.escapeHtml(status)}</option>`).join('')}</select></article>`;
}
function inspectorReviewsTab(frame) {
  const reviews = state.reviews.filter(review => review.fragmentId === frame.fragmentId && !Domain.CLOSED_REVIEW_STATUSES.has(review.status));
  return `<section class="inspector-section"><div class="inline-actions"><button id="addTextReview" class="button secondary small">Текст</button><button id="addImageReview" class="button secondary small">Изображение</button></div></section>${reviews.length ? reviews.map(reviewCard).join('') : '<div class="empty-state" style="min-height:150px;padding:18px"><div><h2>Замечаний нет</h2><p>Добавьте текстовое или визуальное замечание.</p></div></div>'}`;
}


async function refreshActiveRoute({ resetReaderScroll = false } = {}) {
  if (state.route === 'reader' && $('readerShell')) return refreshReaderContent({ resetScroll: resetReaderScroll });
  return render();
}

function readerInspectorHtml(frame) {
  if (!frame) return '';
  return state.inspectorTab === 'image' ? inspectorImageTab(frame) : state.inspectorTab === 'reviews' ? inspectorReviewsTab(frame) : inspectorFrameTab(frame);
}

function updateReaderBackdrop() {
  const backdrop = $('readerDrawerBackdrop');
  if (!backdrop) return;
  const layout = $('readerShell');
  const visible = layout?.querySelector('.reader-sidebar.open, .reader-inspector.open, .reader-mobile-sheet.open');
  backdrop.classList.toggle('visible', !!visible);
}

function closeReaderOverlays() {
  view.querySelector('.reader-sidebar')?.classList.remove('open');
  view.querySelector('.reader-inspector')?.classList.remove('open');
  closeReaderSheet();
  updateReaderBackdrop();
}

function openReaderSheet({ title, body, footer = '' }) {
  const sheet = $('readerMobileSheet');
  if (!sheet) return;
  $('readerSheetTitle').textContent = title;
  $('readerSheetBody').innerHTML = body;
  $('readerSheetFooter').innerHTML = footer;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  updateReaderBackdrop();
}

function closeReaderSheet() {
  const sheet = $('readerMobileSheet');
  if (!sheet) return;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  updateReaderBackdrop();
}

function openReaderTools() {
  const context = state.readerContextCount;
  openReaderSheet({ title: 'Инструменты чтения', body: `<div class="reader-tool-grid"><button id="readerToolPreview" class="button secondary">Мобильное превью</button><button id="readerToolInspector" class="button secondary">Инспектор кадра</button><button id="readerToolFirst" class="button secondary">Первая реплика</button><button id="readerToolLast" class="button secondary">Последняя реплика</button><button id="readerToolFocus" class="button ${state.readerFocus ? 'primary' : 'secondary'}">${state.readerFocus ? 'Выйти из фокуса' : 'Режим фокуса'}</button></div><section class="reader-sheet-section"><span class="kicker">КОНТЕКСТ</span><p class="muted">Сколько предыдущих реплик показывать над текущей.</p><div class="reader-context-picker"><button class="button ${context === 0 ? 'primary' : 'secondary'}" data-reader-context="0">Нет</button><button class="button ${context === 1 ? 'primary' : 'secondary'}" data-reader-context="1">1</button><button class="button ${context === 2 ? 'primary' : 'secondary'}" data-reader-context="2">2</button><button class="button ${context === 'auto' ? 'primary' : 'secondary'}" data-reader-context="auto">Авто</button></div></section><section class="reader-sheet-section"><span class="kicker">ТИПОГРАФИКА</span><label class="field"><span>Размер текста · ${Math.round(state.readerTextScale * 100)}%</span><input id="readerTextScale" type="range" min="0.9" max="1.3" step="0.05" value="${state.readerTextScale}"></label><label class="field"><span>Интерлиньяж</span><input id="readerLineHeight" type="range" min="1.45" max="1.8" step="0.05" value="${state.readerLineHeight}"></label><label class="field"><span>Шрифт</span><select id="readerFont" class="select"><option value="serif" ${state.readerFont === 'serif' ? 'selected' : ''}>Литературный serif</option><option value="sans" ${state.readerFont === 'sans' ? 'selected' : ''}>Нейтральный sans-serif</option></select></label><label class="field"><span>Ширина колонки</span><select id="readerColumnWidth" class="select"><option value="680" ${state.readerColumnWidth == 680 ? 'selected' : ''}>Узкая · 680 px</option><option value="790" ${state.readerColumnWidth == 790 ? 'selected' : ''}>Стандарт · 790 px</option><option value="900" ${state.readerColumnWidth == 900 ? 'selected' : ''}>Широкая · 900 px</option></select></label></section>`, footer: `<button id="readerToolsClose" class="button primary">Готово</button>` });
  $('readerToolPreview').onclick = () => { closeReaderSheet(); setRoute('preview'); };
  $('readerToolInspector').onclick = () => { closeReaderSheet(); view.querySelector('.reader-inspector')?.classList.add('open'); updateReaderBackdrop(); };
  $('readerToolFirst').onclick = () => { closeReaderSheet(); selectFragment(currentFrames()[0]?.fragmentId, { direct: true }); };
  $('readerToolLast').onclick = () => { closeReaderSheet(); selectFragment(currentFrames().at(-1)?.fragmentId, { direct: true }); };
  $('readerToolFocus').onclick = () => { state.readerFocus = !state.readerFocus; persistReaderPrefs(); closeReaderSheet(); applyReaderPreferences(); };
  $('readerToolsClose').onclick = closeReaderSheet;
  view.querySelectorAll('[data-reader-context]').forEach(button => button.onclick = async () => { const value = button.dataset.readerContext; state.readerContextCount = value === 'auto' ? 'auto' : Number(value); persistReaderPrefs(); closeReaderSheet(); await refreshReaderContent({ resetScroll: true }); });
  const applyPrefInputs = () => { state.readerTextScale = Number($('readerTextScale').value); state.readerLineHeight = Number($('readerLineHeight').value); state.readerFont = $('readerFont').value; state.readerColumnWidth = Number($('readerColumnWidth').value); persistReaderPrefs(); applyReaderPreferences(); };
  ['readerTextScale','readerLineHeight'].forEach(id => $(id).oninput = applyPrefInputs); ['readerFont','readerColumnWidth'].forEach(id => $(id).onchange = applyPrefInputs);
}

function openMobileFrameEditor(frame) {
  if (!frame) return;
  openReaderSheet({
    title: 'Редактировать реплику',
    body: `<label class="field"><span>${Domain.textTypeLabel(frame.type)} · ${Domain.escapeHtml(frame.fragmentId)}</span><textarea id="readerMobileTextEditor" class="textarea reader-mobile-editor">${Domain.escapeHtml(frame.text)}</textarea></label><details class="reader-original"><summary>Показать оригинал</summary><div>${Domain.escapeHtml(frame.originalText || frame.text)}</div></details>`,
    footer: `<button id="readerMobileEditCancel" class="button secondary">Отмена</button><button id="readerMobileRestore" class="button secondary">Оригинал</button><button id="readerMobileEditSave" class="button primary">Сохранить</button>`
  });
  const editor = $('readerMobileTextEditor');
  $('readerMobileEditCancel').onclick = closeReaderSheet;
  $('readerMobileRestore').onclick = () => { editor.value = frame.originalText || frame.text; editor.focus(); };
  $('readerMobileEditSave').onclick = async () => {
    const value = editor.value;
    closeReaderSheet();
    await changeText(frame.fragmentId, value);
  };
  requestAnimationFrame(() => { editor?.focus({ preventScroll: true }); editor?.setSelectionRange(editor.value.length, editor.value.length); });
}

async function refreshReaderContent({ resetScroll = true, updateInspector = true } = {}) {
  if (!$('readerShell')) return renderReader();
  syncSelectedWithEngine();
  const frame = effectiveFrame();
  view.querySelectorAll('.reader-title-main').forEach(title => title.textContent = frame ? `${frame.chapterTitle} · ${frame.sceneTitle}` : 'Кадр не выбран');
  view.querySelectorAll('.reader-title-meta').forEach(meta => meta.textContent = frame ? `${frame.fragmentId} · ${Domain.textTypeLabel(frame.type)}` : '');
  const scroll = $('readerScroll');
  if (scroll) scroll.innerHTML = readerCurrentHtml();
  view.querySelectorAll('[data-scene-id]').forEach(button => button.classList.toggle('active', button.dataset.sceneId === state.selectedSceneId));
  if (updateInspector && $('inspectorBody')) {
    $('inspectorBody').innerHTML = readerInspectorHtml(frame);
    view.querySelectorAll('[data-inspector-tab]').forEach(button => button.classList.toggle('active', button.dataset.inspectorTab === state.inspectorTab));
  }
  await hydrateImages(scroll || view);
  if (updateInspector && $('inspectorBody')) await hydrateImages($('inspectorBody'));
  wireReader(frame);
  applyReaderPreferences();
  if (resetScroll && scroll) requestAnimationFrame(() => scroll.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  return frame;
}

async function renderReader() {
  if (!state.project) return renderNoProject('reader');
  syncSelectedWithEngine();
  const frame = effectiveFrame();
  view.className = 'view reader-route';
  view.innerHTML = `<section class="page full"><div id="readerShell" class="reader-layout"><aside class="reader-sidebar"><div class="reader-pane-head"><h2>${Domain.escapeHtml(state.project.title)}</h2><p>${Domain.escapeHtml(state.version.label)}</p></div><div class="scene-search"><input id="sceneSearch" class="input" placeholder="Сцена или ID"></div><div id="sceneTree" class="scene-tree">${readerSceneTree()}</div></aside><section class="reader-center"><header class="reader-toolbar reader-toolbar-desktop"><button data-reader-action="scenes" class="button secondary small">Структура</button><div class="reader-title"><strong class="reader-title-main">${frame ? Domain.escapeHtml(`${frame.chapterTitle} · ${frame.sceneTitle}`) : 'Кадр не выбран'}</strong><span class="reader-title-meta">${frame ? Domain.escapeHtml(`${frame.fragmentId} · ${Domain.textTypeLabel(frame.type)}`) : ''}</span></div><div class="reader-toolbar-actions"><button data-reader-action="focus" class="button secondary small">Фокус</button><button data-reader-action="settings" class="button secondary small">Настройки</button><button data-reader-action="preview" class="button secondary small">Превью</button><button data-reader-action="inspector" class="button secondary small">Инспектор</button></div></header><header class="reader-toolbar reader-toolbar-mobile"><button data-reader-action="scenes" class="button secondary reader-mobile-icon" aria-label="Открыть структуру">☰</button><div class="reader-title"><strong class="reader-title-main">${frame ? Domain.escapeHtml(`${frame.chapterTitle} · ${frame.sceneTitle}`) : 'Кадр не выбран'}</strong><span class="reader-title-meta">${frame ? Domain.escapeHtml(`${frame.fragmentId} · ${Domain.textTypeLabel(frame.type)}`) : ''}</span></div><button data-reader-action="settings" class="button secondary reader-mobile-icon" aria-label="Инструменты чтения">•••</button></header><div id="readerScroll" class="reader-scroll">${readerCurrentHtml()}</div><footer class="reader-bottom reader-bottom-desktop"><button data-reader-action="first" class="button secondary">Первая</button><button data-reader-action="back" class="button secondary">← Назад</button><button data-reader-action="forward" class="button primary">Вперёд →</button><button data-reader-action="last" class="button secondary">Последняя</button></footer><footer class="reader-bottom reader-bottom-mobile"><button data-reader-action="back" class="button secondary">← Назад</button><button data-reader-action="forward" class="button primary">Вперёд →</button></footer></section><aside class="reader-inspector"><div class="inspector-tabs"><button class="inspector-tab ${state.inspectorTab === 'frame' ? 'active' : ''}" data-inspector-tab="frame">Кадр</button><button class="inspector-tab ${state.inspectorTab === 'image' ? 'active' : ''}" data-inspector-tab="image">Изображение</button><button class="inspector-tab ${state.inspectorTab === 'reviews' ? 'active' : ''}" data-inspector-tab="reviews">Замечания</button></div><div id="inspectorBody" class="inspector-body">${readerInspectorHtml(frame)}</div></aside><div id="readerDrawerBackdrop" class="reader-drawer-backdrop" aria-hidden="true"></div><section id="readerMobileSheet" class="reader-mobile-sheet" aria-hidden="true"><header class="reader-sheet-head"><h2 id="readerSheetTitle"></h2><button id="readerSheetClose" class="icon-button" aria-label="Закрыть">×</button></header><div id="readerSheetBody" class="reader-sheet-body"></div><footer id="readerSheetFooter" class="reader-sheet-footer"></footer></section></div></section>`
  await hydrateImages(view);
  wireReader(frame);
  applyReaderPreferences();
  requestAnimationFrame(() => $('readerScroll')?.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
}

function wireReader(frame) {
  view.querySelectorAll('[data-scene-id]').forEach(button => button.onclick = async () => {
    const scene = sceneById(button.dataset.sceneId);
    const first = sceneFrames(scene)[0];
    if (first) {
      view.querySelector('.reader-sidebar')?.classList.remove('open');
      updateReaderBackdrop();
      await selectFragment(first.fragmentId, { direct: true });
    }
  });
  if ($('sceneSearch')) $('sceneSearch').oninput = event => {
    const query = event.target.value.trim().toLowerCase();
    view.querySelectorAll('[data-scene-id]').forEach(button => {
      const matches = !query || (button.dataset.sceneSearch || button.textContent.toLowerCase()).includes(query);
      button.classList.toggle('hidden', !matches);
    });
    view.querySelectorAll('[data-scene-family]').forEach(family => {
      const visible = [...family.querySelectorAll('[data-scene-id]')].some(button => !button.classList.contains('hidden'));
      family.classList.toggle('hidden', !visible);
      if (query && visible) family.open = true;
    });
    view.querySelectorAll('[data-reader-chapter]').forEach(chapter => {
      const visible = [...chapter.querySelectorAll('[data-scene-id]')].some(button => !button.classList.contains('hidden'));
      chapter.classList.toggle('hidden', !visible);
      if (query && visible) chapter.open = true;
    });
  };
  if ($('readerSheetClose')) $('readerSheetClose').onclick = closeReaderSheet;
  if ($('readerDrawerBackdrop')) $('readerDrawerBackdrop').onclick = closeReaderOverlays;
  view.querySelectorAll('[data-inspector-tab]').forEach(button => button.onclick = async () => { state.inspectorTab = button.dataset.inspectorTab; await refreshReaderContent({ resetScroll: false }); });
  $('commentCurrent')?.addEventListener('click', () => openReviewForm({ targetType: 'text' }));
  $('editCurrent')?.addEventListener('click', async () => {
    if (isMobileReader()) return openMobileFrameEditor(frame);
    state.inspectorTab = 'frame';
    await refreshReaderContent({ resetScroll: false });
    setTimeout(() => $('frameTextEditor')?.focus(), 30);
  });
  view.querySelectorAll('[data-choice-option]').forEach(button => button.onclick = async () => {
    if (state.directFragmentId) {
      const frameRef = Domain.getFrameRef(currentContent(), state.directFragmentId);
      const scene = frameRef.scene;
      const choice = frameRef.step;
      const session = createSession(state.project.projectId, state.version.versionId, currentContent());
      session.sceneId = scene.id;
      session.ip = Math.max(0, scene.steps.findIndex(step => step.fragmentId === choice.fragmentId) + 1);
      session.timeline = [{ kind: 'choice', sceneId: scene.id, fragmentId: choice.fragmentId, choiceId: choice.id, selectedOptionId: null, selectedLabel: null, beforeEngine: {}, at: Domain.now() }];
      session.viewIndex = 0;
      state.session = session;
      state.engine = new StoryEngine(currentContent(), session);
      state.directFragmentId = null;
    }
    state.engine.choose(button.dataset.choiceOption);
    await saveSession();
    syncSelectedWithEngine();
    await persistWorkspaceSelection();
    await refreshReaderContent({ resetScroll: true });
  });
  const goBack = async () => { if (state.directFragmentId) return moveDirect(-1); state.engine.back(); syncSelectedWithEngine(); await saveSession(); await persistWorkspaceSelection(); await refreshReaderContent({ resetScroll: true }); };
  const goForward = async () => { if (state.directFragmentId) return moveDirect(1); const entry = state.engine.currentEntry(); if (entry?.kind === 'choice' && !entry.selectedOptionId) return toast('Сначала выберите действие'); await state.engine.forward(); syncSelectedWithEngine(); await saveSession(); await persistWorkspaceSelection(); await refreshReaderContent({ resetScroll: true }); };
  view.querySelectorAll('[data-reader-action]').forEach(button => button.onclick = async () => { const action = button.dataset.readerAction; if (action === 'scenes') { view.querySelector('.reader-sidebar')?.classList.toggle('open'); view.querySelector('.reader-inspector')?.classList.remove('open'); closeReaderSheet(); updateReaderBackdrop(); } else if (action === 'inspector') { view.querySelector('.reader-inspector')?.classList.toggle('open'); view.querySelector('.reader-sidebar')?.classList.remove('open'); closeReaderSheet(); updateReaderBackdrop(); } else if (action === 'preview') await setRoute('preview'); else if (action === 'settings') openReaderTools(); else if (action === 'focus') { state.readerFocus = !state.readerFocus; persistReaderPrefs(); applyReaderPreferences(); } else if (action === 'first') await selectFragment(currentFrames()[0]?.fragmentId, { direct: true }); else if (action === 'last') await selectFragment(currentFrames().at(-1)?.fragmentId, { direct: true }); else if (action === 'back') await goBack(); else if (action === 'forward') await goForward(); });
  if (!frame) return;
  $('saveFrameText')?.addEventListener('click', () => changeText(frame.fragmentId, $('frameTextEditor').value));
  $('restoreFrameText')?.addEventListener('click', () => changeText(frame.fragmentId, frame.originalText));
  $('openStoryboardCurrent')?.addEventListener('click', () => setRoute('storyboard'));
  $('openPreviewCurrent')?.addEventListener('click', () => setRoute('preview'));
  $('replaceFrameAsset')?.addEventListener('click', () => { $('frameAssetInput').value = ''; $('frameAssetInput').click(); });
  $('copyPreviousAsset')?.addEventListener('click', copyPreviousVisual);
  $('removeFrameAsset')?.addEventListener('click', removeCurrentVisual);
  $('saveVisualSettings')?.addEventListener('click', saveVisualSettingsFromInspector);
  $('visualReviewButton')?.addEventListener('click', () => openReviewForm({ targetType: 'image', anchor: state.pendingVisualAnchor }));
  $('addTextReview')?.addEventListener('click', () => openReviewForm({ targetType: 'text' }));
  $('addImageReview')?.addEventListener('click', () => openReviewForm({ targetType: 'image', anchor: state.pendingVisualAnchor }));
  $('inspectorVisual')?.addEventListener('click', async event => {
    if (!frame.asset) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
    state.pendingVisualAnchor = anchor;
    if (event.shiftKey) return openReviewForm({ targetType: 'image', anchor });
    const after = { ...frame.assignment, focalPoint: anchor, status: frame.assignment.status === 'approved' ? 'needs-review' : frame.assignment.status, updatedAt: Domain.now() };
    await applyAssignmentChange(frame.fragmentId, after, 'focal point');
    await refreshReaderContent({ resetScroll: false });
  });
  view.querySelectorAll('[data-review-status]').forEach(select => select.onchange = () => updateReviewStatus(select.dataset.reviewStatus, select.value));
}

async function moveDirect(delta) {
  const frames = currentFrames();
  const index = frames.findIndex(frame => frame.fragmentId === state.directFragmentId);
  const target = frames[index + delta];
  if (target) await selectFragment(target.fragmentId, { direct: true });
}

async function copyPreviousVisual() {
  const frames = currentFrames();
  const index = selectedFrameIndex();
  const previous = frames[index - 1];
  if (!previous) return toast('Предыдущего кадра нет');
  try {
    const after = await Assets.copyPreviousAssignment(state.project.projectId, workspaceScope(), previous.fragmentId, state.selectedFragmentId);
    await applyAssignmentChange(state.selectedFragmentId, after, 'copy previous visual');
    toast('Изображение предыдущего кадра использовано');
    await refreshReaderContent({ resetScroll: false });
  } catch (error) { toast(error.message); }
}

async function removeCurrentVisual() {
  const before = currentAssignment();
  const after = { ...before, assetId: null, status: 'missing', updatedAt: Domain.now() };
  await applyAssignmentChange(state.selectedFragmentId, after, 'remove visual');
  toast('Связь с изображением удалена');
  await refreshReaderContent({ resetScroll: false });
}

async function saveVisualSettingsFromInspector() {
  const current = currentAssignment();
  const after = { ...current, zoom: Number($('visualZoom').value), overlayOpacity: Number($('visualOverlay').value), status: $('visualStatus').value, updatedAt: Domain.now() };
  if (!after.assetId && after.status !== 'missing') after.status = 'missing';
  await applyAssignmentChange(state.selectedFragmentId, after, 'visual settings');
  toast('Настройки визуала сохранены');
  await refreshReaderContent({ resetScroll: false });
}

function renderNoProject(route) {
  view.className = 'view';
  view.innerHTML = `<section class="page"><div class="empty-state"><div><h2>Сначала откройте проект</h2><p>Раздел «${Domain.escapeHtml(route)}» доступен после выбора новеллы.</p><button id="goLibrary" class="button primary">В библиотеку</button></div></div></section>`;
  $('goLibrary').onclick = () => setRoute('library');
}

async function renderStoryboard() {
  if (!state.project) return renderNoProject('Сториборд');
  const scene = selectedScene() || currentContent().scenes[0];
  state.selectedSceneId = scene.id;
  const allStoryboardFrames = sceneFrames(scene).filter(frame => {
    const assignment = currentAssignment(frame.fragmentId);
    if (state.storyboardFilter === 'missing') return !assignment?.assetId;
    if (state.storyboardFilter === 'needs-review') return assignment?.status === 'needs-review';
    if (state.storyboardFilter === 'approved') return assignment?.status === 'approved';
    if (state.storyboardFilter === 'reviews') return currentReviews(frame.fragmentId).length > 0;
    return true;
  });
  const frames = allStoryboardFrames.slice(0, state.storyboardLimit);
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">СТОРИБОРД</span><h1>${Domain.escapeHtml(scene.chapterTitle)} · ${Domain.escapeHtml(scene.title)}</h1><p>Визуальная последовательность кадр за кадром.</p></div><div class="header-actions"><button id="batchAssets" class="button secondary">Загрузить изображения</button><button id="approveSelectedFrames" class="button secondary">Утвердить выбранные</button><button id="nextMissing" class="button primary">Следующий без изображения</button></div></header>
    <div class="storyboard-toolbar"><select id="storyboardScene" class="select">${currentContent().scenes.map(item => `<option value="${Domain.escapeHtml(item.id)}" ${item.id === scene.id ? 'selected' : ''}>${Domain.escapeHtml(`${item.chapterTitle} · ${item.id} · ${item.title}`)}</option>`).join('')}</select><select id="storyboardFilter" class="select"><option value="all">Все кадры</option><option value="missing">Без изображения</option><option value="needs-review">Требуют проверки</option><option value="approved">Утверждённые</option><option value="reviews">С замечаниями</option></select><span class="status-badge">${allStoryboardFrames.length} ${Domain.plural(allStoryboardFrames.length, 'кадр', 'кадра', 'кадров')}</span></div>
    <div class="storyboard-grid">${frames.map((fragment, index) => {
      const ref = Domain.getFrameRef(currentContent(), fragment.fragmentId);
      const assignment = currentAssignment(fragment.fragmentId);
      const asset = assignment?.assetId ? state.assetMap.get(assignment.assetId) : null;
      const text = Domain.effectiveText(ref.step, state.workspace);
      return `<article class="card frame-card" data-frame-card="${Domain.escapeHtml(fragment.fragmentId)}"><div class="frame-thumb">${asset ? `<img data-asset-src="${Domain.escapeHtml(asset.assetId)}" data-thumbnail="true" alt="">` : '<div class="visual-placeholder"><strong>Нет изображения</strong></div>'}</div><div class="frame-card-copy"><h3><span><input type="checkbox" data-select-frame="${fragment.fragmentId}" ${state.storyboardSelection.has(fragment.fragmentId) ? 'checked' : ''} aria-label="Выбрать кадр"> ${Domain.escapeHtml(ref.step.speaker || Domain.textTypeLabel(ref.step.type))}</span><small>${index + 1}/${frames.length}</small></h3><div class="frame-card-text">${Domain.escapeHtml(text)}</div><div class="frame-card-meta"><span class="status-badge ${assignment?.status || 'missing'}">${Domain.statusLabel(assignment?.status || 'missing')}</span>${currentReviews(fragment.fragmentId).length ? `<span class="status-badge needs-review">${currentReviews(fragment.fragmentId).length} замеч.</span>` : ''}</div></div><div class="frame-card-actions"><button class="button secondary small" data-card-reader="${fragment.fragmentId}">Читать</button><button class="button secondary small" data-card-preview="${fragment.fragmentId}">Превью</button><button class="button primary small" data-card-image="${fragment.fragmentId}">${asset ? 'Заменить' : 'Изображение'}</button></div></article>`;
    }).join('')}</div>${frames.length ? '' : '<div class="empty-state"><div><h2>Кадры не найдены</h2><p>Измените фильтр.</p></div></div>'}${allStoryboardFrames.length > frames.length ? '<div class="load-more-wrap"><button id="storyboardLoadMore" class="button secondary">Показать ещё</button></div>' : ''}</section>`;
  $('storyboardFilter').value = state.storyboardFilter;
  $('storyboardFilter').onchange = () => { state.storyboardFilter = $('storyboardFilter').value; state.storyboardLimit = 60; renderStoryboard(); };
  $('storyboardScene').onchange = () => { state.selectedSceneId = $('storyboardScene').value; state.storyboardLimit = 60; renderStoryboard(); };
  $('storyboardLoadMore')?.addEventListener('click', () => { state.storyboardLimit += 60; renderStoryboard(); });
  $('batchAssets').onclick = () => { $('assetInput').dataset.mode = 'batch-storyboard'; $('assetInput').value = ''; $('assetInput').click(); };
  $('approveSelectedFrames').onclick = async () => {
    const ids = [...state.storyboardSelection];
    if (!ids.length) return toast('Выберите кадры');
    let approved = 0;
    for (const fragmentId of ids) {
      const assignment = currentAssignment(fragmentId);
      if (!assignment?.assetId) continue;
      const after = { ...assignment, status: 'approved', approvedAt: Domain.now(), updatedAt: Domain.now() };
      await DB.put('visualAssignments', after);
      state.assignmentMap.set(fragmentId, after);
      const index = state.assignments.findIndex(item => item.fragmentId === fragmentId);
      if (index >= 0) state.assignments[index] = after;
      approved++;
    }
    state.storyboardSelection.clear();
    toast(`Утверждено кадров: ${approved}`);
    renderStoryboard();
  };
  view.querySelectorAll('[data-select-frame]').forEach(input => input.onchange = () => { if (input.checked) state.storyboardSelection.add(input.dataset.selectFrame); else state.storyboardSelection.delete(input.dataset.selectFrame); });
  $('nextMissing').onclick = () => {
    const missing = currentFrames().find(frame => !currentAssignment(frame.fragmentId)?.assetId);
    if (!missing) return toast('Все кадры имеют изображения');
    selectFragment(missing.fragmentId, { route: 'storyboard', direct: true });
  };
  view.querySelectorAll('[data-card-reader]').forEach(button => button.onclick = () => selectFragment(button.dataset.cardReader, { route: 'reader', direct: true }));
  view.querySelectorAll('[data-card-preview]').forEach(button => button.onclick = () => selectFragment(button.dataset.cardPreview, { route: 'preview', direct: true }));
  view.querySelectorAll('[data-card-image]').forEach(button => button.onclick = () => { state.selectedFragmentId = button.dataset.cardImage; $('frameAssetInput').value = ''; $('frameAssetInput').click(); });
  await hydrateImages(view);
}

async function renderAssets() {
  if (!state.project) return renderNoProject('Изображения');
  const query = state.assetSearch.toLowerCase();
  const allAssets = state.assets.filter(asset => !query || `${asset.name} ${asset.assetId}`.toLowerCase().includes(query));
  const assets = allAssets.slice(0, state.assetLimit);
  const usageMap = new Map();
  for (const assignment of state.assignments) if (assignment.assetId) usageMap.set(assignment.assetId, (usageMap.get(assignment.assetId) || 0) + 1);
  if (state.project?.coverAssetId) usageMap.set(state.project.coverAssetId, (usageMap.get(state.project.coverAssetId) || 0) + 1);
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">ASSET LIBRARY</span><h1>Изображения проекта</h1><p>Оригиналы хранятся как Blob в IndexedDB; кадры используют независимые VisualAssignment.</p></div><div class="header-actions"><button id="uploadAssets" class="button primary">Загрузить изображения</button></div></header><div class="filters"><input id="assetSearch" class="input" style="max-width:420px" placeholder="Название или Asset ID" value="${Domain.escapeHtml(state.assetSearch)}"><span class="status-badge">${allAssets.length} файлов</span></div><div class="asset-grid">${assets.map(asset => `<article class="card asset-card"><div class="asset-thumb"><img data-asset-src="${Domain.escapeHtml(asset.assetId)}" data-thumbnail="true" alt=""></div><div class="asset-copy"><strong title="${Domain.escapeHtml(asset.name)}">${Domain.escapeHtml(asset.name)}</strong><small>${asset.width}×${asset.height} · ${Math.round(asset.fileSize / 1024)} КБ · используется: ${usageMap.get(asset.assetId) || 0}</small></div><div class="asset-actions"><button class="button primary small" data-assign-asset="${asset.assetId}">Назначить кадру</button><button class="button secondary small" data-delete-asset="${asset.assetId}">Удалить</button></div></article>`).join('')}</div>${assets.length ? '' : '<div class="empty-state"><div><h2>Изображений нет</h2><p>Загрузите PNG, JPEG, WebP или AVIF.</p></div></div>'}${allAssets.length > assets.length ? '<div class="load-more-wrap"><button id="assetsLoadMore" class="button secondary">Показать ещё</button></div>' : ''}</section>`;
  $('uploadAssets').onclick = () => { $('assetInput').dataset.mode = 'library'; $('assetInput').value = ''; $('assetInput').click(); };
  $('assetSearch').oninput = event => { state.assetSearch = event.target.value; state.assetLimit = 80; renderAssets(); };
  $('assetsLoadMore')?.addEventListener('click', () => { state.assetLimit += 80; renderAssets(); });
  view.querySelectorAll('[data-assign-asset]').forEach(button => button.onclick = async () => {
    if (!state.selectedFragmentId) return toast('Сначала выберите кадр в Reader или Storyboard');
    const before = currentAssignment();
    const after = { ...before, assetId: button.dataset.assignAsset, status: before.status === 'approved' ? 'needs-review' : 'draft', updatedAt: Domain.now() };
    await applyAssignmentChange(state.selectedFragmentId, after, 'assign asset');
    toast('Изображение назначено текущему кадру');
    renderAssets();
  });
  view.querySelectorAll('[data-delete-asset]').forEach(button => button.onclick = async () => {
    try { await Assets.deleteAsset(state.project.projectId, button.dataset.deleteAsset); await refreshProjectData(); renderAssets(); }
    catch (error) { if (confirm(`${error.message}. Удалить принудительно и снять его со всех кадров?`)) { await Assets.deleteAsset(state.project.projectId, button.dataset.deleteAsset, { force: true }); await refreshProjectData(); renderAssets(); } }
  });
  await hydrateImages(view);
}

async function renderPreview() {
  state.previewDraftAssignment = null;
  if (!state.project) return renderNoProject('Превью');
  const frame = effectiveFrame();
  if (!frame) return renderNoProject('Превью');
  const deviceVisual = Domain.visualForDevice(frame.assignment, state.previewDeviceId);
  const hasOverride = Boolean(frame.assignment?.deviceOverrides?.[state.previewDeviceId]);
  view.className = 'view';
  view.innerHTML = `<section class="page full"><div class="preview-layout"><aside class="preview-controls ${state.previewMobileSheet === 'controls' ? 'mobile-open' : ''}"><div class="preview-sheet-head"><strong>Настройки превью</strong><button id="closePreviewControls" class="icon-button" type="button">×</button></div><span class="kicker">MOBILE PREVIEW LAB</span><h2 style="margin:5px 0 16px">Настройки устройства</h2><div class="preview-control-group"><label class="field"><span>Устройство</span><select id="previewDevice" class="select">${Object.values(DEVICE_PRESETS).map(device => `<option value="${device.id}" ${device.id === state.previewDeviceId ? 'selected' : ''}>${device.label}</option>`).join('')}</select></label><label class="field"><span>Ориентация</span><select id="previewOrientation" class="select"><option value="portrait">Вертикальная</option><option value="landscape">Горизонтальная</option></select></label><label class="field"><span>Режим</span><select id="previewCompare" class="select"><option value="single">Одно устройство</option><option value="compare">Сравнить 3 устройства</option></select></label></div><div class="preview-control-group"><h3>Кадрирование</h3><label class="field"><span>Focal X</span><input id="previewFocalX" type="range" min="0" max="1" step="0.01" value="${deviceVisual.focalPoint.x}"></label><label class="field"><span>Focal Y</span><input id="previewFocalY" type="range" min="0" max="1" step="0.01" value="${deviceVisual.focalPoint.y}"></label><label class="field"><span>Zoom</span><input id="previewZoom" type="range" min="1" max="2.2" step="0.02" value="${deviceVisual.zoom}"></label><label class="field"><span>Прозрачность панели</span><input id="previewOverlay" type="range" min="0" max="0.35" step="0.01" value="${deviceVisual.overlayOpacity}"></label><label class="field" style="grid-template-columns:auto 1fr;align-items:center"><input id="previewUseOverride" type="checkbox" ${hasOverride ? 'checked' : ''}><span>Сохранить только для ${Domain.escapeHtml(DEVICE_PRESETS[state.previewDeviceId]?.label || state.previewDeviceId)}</span></label><button id="savePreviewCrop" class="button primary small">Сохранить кадрирование</button></div><div class="preview-control-group"><h3>Текст и панель</h3><label class="field"><span>Масштаб текста</span><input id="previewTextScale" type="range" min="0.85" max="1.35" step="0.05" value="${state.previewTextScale}"></label><label class="field"><span>Стиль панели</span><select id="previewPanelStyle" class="select"><option value="glass">Светлое стекло</option><option value="solid">Плотная</option></select></label></div><div class="preview-control-group"><h3>Кадр</h3><p><strong>${Domain.escapeHtml(frame.speaker || Domain.textTypeLabel(frame.type))}</strong><br><span class="muted">${Domain.escapeHtml(frame.fragmentId)}</span></p><div class="inline-actions"><button id="previewPrev" class="button secondary small">← Предыдущий</button><button id="previewNext" class="button secondary small">Следующий →</button></div><button id="previewReader" class="button secondary small" style="margin-top:8px">Открыть в Reader</button></div></aside><div class="preview-mobile-actions"><button id="mobilePreviewSettings" class="button secondary small">Настройки</button><button id="mobilePreviewDiagnostics" class="button secondary small">Проверка</button></div><main id="previewStage" class="preview-stage"></main><aside class="preview-diagnostics ${state.previewMobileSheet === 'diagnostics' ? 'mobile-open' : ''}"><div class="preview-sheet-head"><strong>Диагностика</strong><button id="closePreviewDiagnostics" class="icon-button" type="button">×</button></div><span class="kicker">QUALITY CHECK</span><h2 style="margin:5px 0 14px">Диагностика кадра</h2><div id="previewDiagnostics"></div></aside></div></section>`;
  $('previewOrientation').value = state.previewOrientation;
  $('previewCompare').value = state.previewCompare ? 'compare' : 'single';
  $('previewPanelStyle').value = state.previewPanelStyle;
  await renderPreviewStage();
  for (const id of ['previewDevice', 'previewOrientation', 'previewCompare', 'previewTextScale', 'previewPanelStyle']) $(id).onchange = () => {
    state.previewDeviceId = $('previewDevice').value;
    state.previewOrientation = $('previewOrientation').value;
    state.previewCompare = $('previewCompare').value === 'compare';
    state.previewTextScale = Number($('previewTextScale').value);
    state.previewPanelStyle = $('previewPanelStyle').value;
    if (id === 'previewDevice') return renderPreview();
    renderPreviewStage();
  };
  for (const id of ['previewFocalX', 'previewFocalY', 'previewZoom', 'previewOverlay', 'previewTextScale']) $(id).oninput = () => {
    state.previewTextScale = Number($('previewTextScale').value);
    const assignment = state.assignmentMap.get(frame.fragmentId);
    const settings = { focalPoint: { x: Number($('previewFocalX').value), y: Number($('previewFocalY').value) }, zoom: Number($('previewZoom').value), overlayOpacity: Number($('previewOverlay').value) };
    if ($('previewUseOverride').checked) state.previewDraftAssignment = { ...assignment, deviceOverrides: { ...(assignment.deviceOverrides || {}), [state.previewDeviceId]: { ...(assignment.deviceOverrides?.[state.previewDeviceId] || {}), ...settings } } };
    else state.previewDraftAssignment = { ...assignment, ...settings };
    renderPreviewStage();
  };
  $('savePreviewCrop').onclick = async () => {
    const assignment = currentAssignment();
    const settings = { focalPoint: { x: Number($('previewFocalX').value), y: Number($('previewFocalY').value) }, zoom: Number($('previewZoom').value), overlayOpacity: Number($('previewOverlay').value) };
    let after;
    if ($('previewUseOverride').checked) {
      after = { ...assignment, deviceOverrides: { ...(assignment.deviceOverrides || {}), [state.previewDeviceId]: { ...(assignment.deviceOverrides?.[state.previewDeviceId] || {}), ...settings } }, status: assignment.status === 'approved' ? 'needs-review' : assignment.status, updatedAt: Domain.now() };
    } else {
      const overrides = { ...(assignment.deviceOverrides || {}) };
      delete overrides[state.previewDeviceId];
      after = { ...assignment, ...settings, deviceOverrides: overrides, status: assignment.status === 'approved' ? 'needs-review' : assignment.status, updatedAt: Domain.now() };
    }
    state.previewDraftAssignment = null;
    await applyAssignmentChange(frame.fragmentId, after, 'preview crop');
    toast('Кадрирование сохранено');
    renderPreview();
  };
  $('previewPrev').onclick = () => movePreview(-1);
  $('previewNext').onclick = () => movePreview(1);
  $('previewReader').onclick = () => setRoute('reader');
  $('mobilePreviewSettings').onclick = () => { state.previewMobileSheet = state.previewMobileSheet === 'controls' ? 'none' : 'controls'; renderPreview(); };
  $('mobilePreviewDiagnostics').onclick = () => { state.previewMobileSheet = state.previewMobileSheet === 'diagnostics' ? 'none' : 'diagnostics'; renderPreview(); };
  $('closePreviewControls').onclick = () => { state.previewMobileSheet = 'none'; renderPreview(); };
  $('closePreviewDiagnostics').onclick = () => { state.previewMobileSheet = 'none'; renderPreview(); };
}

async function renderPreviewStage() {
  const host = $('previewStage');
  if (!host) return;
  const frame = effectiveFrame();
  const assetUrl = frame?.asset ? await Assets.assetObjectUrl(frame.asset.assetId) : null;
  let results;
  if (state.previewCompare) {
    const devices = [DEVICE_PRESETS.android360, DEVICE_PRESETS.iphone390, DEVICE_PRESETS.android412];
    results = renderDeviceComparison(host, devices.map(device => ({ frame, device, orientation: state.previewOrientation, assetUrl, textScale: state.previewTextScale, panelStyle: state.previewPanelStyle })));
  } else {
    const device = DEVICE_PRESETS[state.previewDeviceId] || DEVICE_PRESETS.iphone390;
    const diagnostics = renderPlayerFrame(host, { frame, device, orientation: state.previewOrientation, assetUrl, textScale: state.previewTextScale, panelStyle: state.previewPanelStyle, onChoose: optionId => toast(`Preview выбора: ${optionId}`) });
    results = [{ device, diagnostics }];
  }
  const diagnosticHost = $('previewDiagnostics');
  diagnosticHost.innerHTML = results.map(result => `<section class="inspector-section"><h3>${Domain.escapeHtml(result.device.label)}</h3><div class="diagnostic-list"><div class="diagnostic ${result.diagnostics.ok ? 'good' : 'warning'}">Строк текста: ${result.diagnostics.lines}<br>Высота панели: ${Math.round(result.diagnostics.ratio * 100)}% экрана</div>${result.diagnostics.warnings.length ? result.diagnostics.warnings.map(item => `<div class="diagnostic ${item.level}">${Domain.escapeHtml(item.text)}</div>`).join('') : '<div class="diagnostic good">Критических проблем не обнаружено.</div>'}</div></section>`).join('');
}

async function movePreview(delta) {
  state.previewDraftAssignment = null;
  const frames = currentFrames();
  const index = selectedFrameIndex();
  const target = frames[index + delta];
  if (!target) return;
  state.selectedFragmentId = target.fragmentId;
  state.directFragmentId = target.fragmentId;
  await persistWorkspaceSelection();
  renderPreview();
}

async function renderReviews() {
  if (!state.project) return renderNoProject('Замечания');
  const query = state.reviewSearch.trim().toLowerCase();
  const reviews = state.reviews.filter(review => {
    if (state.reviewFilter === 'open' && Domain.CLOSED_REVIEW_STATUSES.has(review.status)) return false;
    if (state.reviewFilter === 'text' && review.targetType !== 'text') return false;
    if (state.reviewFilter === 'image' && review.targetType !== 'image') return false;
    if (state.reviewFilter === 'critical' && !(review.severity === 'critical' && !Domain.CLOSED_REVIEW_STATUSES.has(review.status))) return false;
    if (query && !`${review.comment || ''} ${review.category || ''} ${review.fragmentId || ''} ${review.quotedText || ''}`.toLowerCase().includes(query)) return false;
    return true;
  }).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
  const groupKey = review => { if (state.reviewGroup === 'type') return review.targetType || 'Другое'; if (state.reviewGroup === 'status') return review.status || 'Без статуса'; const ref=Domain.getFrameRef(currentContent(),review.fragmentId); return ref ? `${ref.scene.chapterTitle} · ${ref.scene.title}` : 'Без сцены'; };
  const groups=new Map(); for (const review of reviews){const key=groupKey(review); if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(review);} 
  const card=review=>`<article class="card pad review-queue-card"><div class="review-card-head"><div><label class="review-select"><input type="checkbox" data-review-select="${review.reviewId}" ${state.reviewSelected.has(review.reviewId)?'checked':''}><span class="kicker">${Domain.escapeHtml(review.targetType)}</span></label><strong>${Domain.escapeHtml(review.category)}</strong></div><span class="status-badge ${review.severity==='critical'?'missing':'draft'}">${Domain.escapeHtml(review.status)}</span></div><p>${Domain.escapeHtml(review.comment)}</p>${review.quotedText?`<blockquote>${Domain.escapeHtml(review.quotedText)}</blockquote>`:''}<div class="inline-actions"><select class="select" style="max-width:210px" data-review-status="${review.reviewId}">${Domain.REVIEW_STATUSES.map(status=>`<option ${status===review.status?'selected':''}>${status}</option>`).join('')}</select><button class="button secondary small" data-review-jump="${review.fragmentId}">Открыть кадр</button></div></article>`;
  view.className='view';
  view.innerHTML=`<section class="page"><header class="page-header"><div><span class="kicker">REVIEW QUEUE</span><h1>Замечания</h1><p>Текстовая, визуальная и композиционная вычитка.</p></div><button id="gptFromReviews" class="button primary">Подготовить для GPT</button></header><div class="review-toolbar"><input id="reviewSearch" class="input" placeholder="Поиск по замечаниям, сценам и Fragment ID" value="${Domain.escapeHtml(state.reviewSearch)}"><select id="reviewFilter" class="select"><option value="open">Открытые</option><option value="all">Все</option><option value="text">Текст</option><option value="image">Изображения</option><option value="critical">Критичные</option></select><select id="reviewGroup" class="select"><option value="scene">По сценам</option><option value="type">По типу</option><option value="status">По статусу</option></select><span class="status-badge">${reviews.length}</span></div><div class="bulk-review-bar"><span>${state.reviewSelected.size} выбрано</span><select id="bulkReviewStatus" class="select">${Domain.REVIEW_STATUSES.map(status=>`<option>${status}</option>`).join('')}</select><button id="applyBulkReview" class="button secondary">Применить статус</button></div><div class="review-list grouped-review-list">${[...groups].map(([group,items])=>`<section class="review-group"><header><strong>${Domain.escapeHtml(group)}</strong><span>${items.length}</span></header>${items.map(card).join('')}</section>`).join('')}</div>${reviews.length?'':'<div class="empty-state"><div><h2>Замечаний нет</h2><p>Открытые задачи появятся здесь.</p></div></div>'}</section>`;
  $('reviewFilter').value=state.reviewFilter; $('reviewGroup').value=state.reviewGroup;
  $('reviewFilter').onchange=()=>{state.reviewFilter=$('reviewFilter').value;renderReviews();}; $('reviewGroup').onchange=()=>{state.reviewGroup=$('reviewGroup').value;renderReviews();};
  $('reviewSearch').oninput=event=>{state.reviewSearch=event.target.value;clearTimeout(state.reviewSearchTimer);state.reviewSearchTimer=setTimeout(renderReviews,180);}; $('gptFromReviews').onclick=exportGptRequest;
  view.querySelectorAll('[data-review-select]').forEach(input=>input.onchange=()=>{input.checked?state.reviewSelected.add(input.dataset.reviewSelect):state.reviewSelected.delete(input.dataset.reviewSelect);renderReviews();});
  $('applyBulkReview').onclick=async()=>{const status=$('bulkReviewStatus').value;for(const id of [...state.reviewSelected])await updateReviewStatus(id,status,{rerender:false});state.reviewSelected.clear();await refreshProjectData();renderReviews();};
  view.querySelectorAll('[data-review-status]').forEach(select=>select.onchange=()=>updateReviewStatus(select.dataset.reviewStatus,select.value)); view.querySelectorAll('[data-review-jump]').forEach(button=>button.onclick=()=>selectFragment(button.dataset.reviewJump,{route:'reader',direct:true}));
}

async function renderVersions() {
  if (!state.project) return renderNoProject('Версии');
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">VERSION CONTROL</span><h1>Версии сценария</h1><p>Текст и визуальный manifest сохраняются как единый snapshot.</p></div><button id="createVersion" class="button primary">Создать версию</button></header><div class="version-list">${state.versions.map(version => `<article class="card version-card"><div class="version-card-head"><div><span class="kicker">${version.versionId === state.version.versionId ? 'ТЕКУЩАЯ' : 'ВЕРСИЯ'}</span><h3>${Domain.escapeHtml(version.label)}</h3><p class="muted">${Domain.formatDate(version.createdAt)}${version.parentVersionId ? ` · parent: ${Domain.escapeHtml(version.parentVersionId)}` : ''}</p>${version.note ? `<p>${Domain.escapeHtml(version.note)}</p>` : ''}</div><div class="inline-actions"><button class="button secondary small" data-open-version="${version.versionId}" ${version.versionId === state.version.versionId ? 'disabled' : ''}>Открыть</button><button class="button secondary small" data-diff-version="${version.versionId}">Diff</button></div></div></article>`).join('')}</div></section>`;
  $('createVersion').onclick = createVersion;
  view.querySelectorAll('[data-open-version]').forEach(button => button.onclick = () => switchVersion(button.dataset.openVersion));
  view.querySelectorAll('[data-diff-version]').forEach(button => button.onclick = () => showVersionDiff(button.dataset.diffVersion));
}

async function createVersion() {
  const label = prompt('Название новой версии', `Редакция ${new Date().toLocaleDateString('ru-RU')}`);
  if (!label) return;
  const note = prompt('Кратко: что изменилось в этой версии?', '') || '';
  const content = Domain.applyTextEditsToContent(currentContent(), state.workspace.textEdits || {});
  const versionId = `${state.project.projectId}::${Domain.slug(label)}-${Date.now().toString(36)}`;
  const validation = parser.validateNovel(content);
  const version = { versionId, projectId: state.project.projectId, label, parentVersionId: state.version.versionId, sourceType: 'editor-v3', note, createdAt: Domain.now(), updatedAt: Domain.now(), content, validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, stats: validation.stats } };
  await DB.put('versions', version);
  await DB.cloneVisualScope(state.project.projectId, workspaceScope(), DB.versionScope(versionId));
  state.project.activeVersionId = versionId;
  state.project.updatedAt = Domain.now();
  await DB.put('projects', state.project);
  state.workspace = { ...state.workspace, baseVersionId: versionId, textEdits: {}, undoStack: [], redoStack: [], dirty: false, updatedAt: Domain.now() };
  await DB.put('workspaceDrafts', state.workspace);
  state.version = version;
  state.versions.unshift(version);
  state.session = createSession(state.project.projectId, versionId, content);
  state.engine = new StoryEngine(content, state.session);
  await DB.put('sessions', state.session);
  toast('Новая версия создана');
  await refreshProjectData({ keepSelection: true });
  renderVersions();
}

async function switchVersion(versionId) {
  if (state.workspace.dirty && !confirm('Текущий workspace содержит несохранённые изменения. Переключить версию и заменить workspace?')) return;
  const version = await DB.get('versions', versionId);
  if (!version) return;
  state.project.activeVersionId = versionId;
  state.project.updatedAt = Domain.now();
  await DB.put('projects', state.project);
  await DB.cloneVisualScope(state.project.projectId, DB.versionScope(versionId), workspaceScope());
  state.workspace = { projectId: state.project.projectId, baseVersionId: versionId, textEdits: {}, selectedFragmentId: null, selectedSceneId: version.content.startScene, undoStack: [], redoStack: [], dirty: false, updatedAt: Domain.now() };
  await DB.put('workspaceDrafts', state.workspace);
  await openProject(state.project.projectId, { route: 'reader' });
}

async function showVersionDiff(versionId) {
  const version=await DB.get('versions',versionId); if(!version)return; const parent=version.parentVersionId?await DB.get('versions',version.parentVersionId):null; if(!parent)return toast('Для первой версии нет parent Diff');
  const beforeMap=new Map(Domain.flattenFrames(parent.content).map(frame=>[frame.fragmentId,frame])); const afterMap=new Map(Domain.flattenFrames(version.content).map(frame=>[frame.fragmentId,frame]));
  const [beforeVisuals,afterVisuals]=await Promise.all([DB.getAllByIndex('visualAssignments','scopeId',DB.versionScope(parent.versionId)),DB.getAllByIndex('visualAssignments','scopeId',DB.versionScope(version.versionId))]); const bv=new Map(beforeVisuals.map(item=>[item.fragmentId,item])); const av=new Map(afterVisuals.map(item=>[item.fragmentId,item]));
  const ids=new Set([...beforeMap.keys(),...afterMap.keys(),...bv.keys(),...av.keys()]); const changes=[...ids].map(id=>({id,before:beforeMap.get(id),after:afterMap.get(id),beforeVisual:bv.get(id),afterVisual:av.get(id)})).filter(item=>{const t=(item.before?.text||'')!==(item.after?.text||'');const v=JSON.stringify({a:item.beforeVisual?.assetId,f:item.beforeVisual?.focalPoint,z:item.beforeVisual?.zoom,s:item.beforeVisual?.status})!==JSON.stringify({a:item.afterVisual?.assetId,f:item.afterVisual?.focalPoint,z:item.afterVisual?.zoom,s:item.afterVisual?.status});return t||v;});
  const body=changes.slice(0,100).map(item=>`<article class="version-diff-card card pad"><header><strong>${Domain.escapeHtml(item.id)}</strong></header><div class="version-diff-visuals"><div><span>Было</span>${item.beforeVisual?.assetId?`<div class="diff-thumb"><img data-asset-src="${Domain.escapeHtml(item.beforeVisual.assetId)}" data-thumbnail="true" alt=""></div>`:'<div class="diff-thumb empty">Нет изображения</div>'}</div><div><span>Стало</span>${item.afterVisual?.assetId?`<div class="diff-thumb"><img data-asset-src="${Domain.escapeHtml(item.afterVisual.assetId)}" data-thumbnail="true" alt=""></div>`:'<div class="diff-thumb empty">Нет изображения</div>'}</div></div><div class="diff-grid"><div class="diff-pane before"><span>Было</span>${Domain.escapeHtml(item.before?.text||'')}</div><div class="diff-pane after"><span>Стало</span>${Domain.escapeHtml(item.after?.text||'')}</div></div><div class="diff-meta">asset: ${Domain.escapeHtml(item.beforeVisual?.assetId||'нет')} → ${Domain.escapeHtml(item.afterVisual?.assetId||'нет')} · zoom: ${item.beforeVisual?.zoom||1} → ${item.afterVisual?.zoom||1} · status: ${item.beforeVisual?.status||'—'} → ${item.afterVisual?.status||'—'}</div></article>`).join('');
  openModal({kicker:'VERSION DIFF',title:`${parent.label} → ${version.label}`,body:`<p class="muted">Изменённых кадров: ${changes.length}</p>${body||'<div class="empty-state"><p>Изменений нет.</p></div>'}`,footer:'<button id="closeDiff" class="button primary">Готово</button>'}); await hydrateImages($('modalBody')); $('closeDiff').onclick=closeModal;
}

async function renderGpt() {
  if (!state.project) return renderNoProject('GPT');
  const candidates = await DB.getAllByIndex('gptCandidates', 'projectId', state.project.projectId);
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">GPT ROUND-TRIP</span><h1>Исправления GPT</h1><p>Экспорт замечаний, импорт revision.json, ручное принятие изменений.</p></div><div class="header-actions"><button id="exportGpt" class="button secondary">Подготовить пакет</button><button id="importGpt" class="button primary">Импорт исправлений</button></div></header><div class="candidate-list">${candidates.map(candidate => `<article class="card candidate-card"><div class="candidate-card-head"><div><span class="kicker">${Domain.escapeHtml(candidate.status || 'КАНДИДАТ')}</span><h3>${Domain.escapeHtml(candidate.label || candidate.candidateId)}</h3><p class="muted">${candidate.changes?.length || 0} изменений · ${Domain.formatDate(candidate.createdAt)}</p></div><button class="button secondary small" data-open-candidate="${candidate.candidateId}">Проверить</button></div></article>`).join('')}</div>${candidates.length ? '' : '<div class="empty-state"><div><h2>Кандидатов нет</h2><p>Подготовьте пакет для GPT, затем импортируйте revision.json.</p></div></div>'}</section>`;
  $('exportGpt').onclick = exportGptRequest;
  $('importGpt').onclick = () => { $('gptInput').value = ''; $('gptInput').click(); };
  view.querySelectorAll('[data-open-candidate]').forEach(button => button.onclick = () => showCandidate(button.dataset.openCandidate));
}

async function exportGptRequest() {
  const openReviews = state.reviews.filter(review => !Domain.CLOSED_REVIEW_STATUSES.has(review.status));
  if (!openReviews.length) return toast('Нет открытых замечаний');
  const changes = openReviews.filter(review => review.targetType === 'text').map(review => {
    const frame = effectiveFrame(review.fragmentId);
    return { reviewId: review.reviewId, fragmentId: review.fragmentId, sceneId: frame?.sceneId, originalText: frame?.text || '', quotedText: review.quotedText || null, comment: review.comment, category: review.category, severity: review.severity, visual: frame?.assignment?.assetId ? { assetId: frame.assignment.assetId, focalPoint: frame.assignment.focalPoint } : null };
  });
  const request = { schema: 'heartline-revision-request-v3', projectId: state.project.projectId, baseVersionId: state.version.versionId, createdAt: Domain.now(), instructions: ['Сохранить Fragment ID.', 'Исправлять только отмеченные места.', 'Вернуть revision.json с changes[].'], changes };
  const prompt = `# HEARTLINE revision request\n\nИсправь только отмеченные фрагменты. Не меняй Fragment ID. Верни JSON формата:\n\n{\n  "baseVersionId": "${state.version.versionId}",\n  "changes": [{"fragmentId":"...","originalText":"...","revisedText":"...","reason":"...","reviewIds":["..."]}]\n}`;
  const bytes = exporter.createZip([{ name: 'revision_request.json', data: JSON.stringify(request, null, 2) }, { name: 'prompt.md', data: prompt }, { name: 'manifest.json', data: JSON.stringify({ schema: 'heartline-gpt-package-v3', projectId: state.project.projectId, baseVersionId: state.version.versionId }, null, 2) }]);
  exporter.downloadBytes(bytes, `${Domain.slug(state.project.title)}_GPT.zip`, 'application/zip');
}

async function showCandidate(candidateId) {
  const candidate=await DB.get('gptCandidates',candidateId); if(!candidate)return; const frames=currentFrames(); const frameIndex=new Map(frames.map((frame,index)=>[frame.fragmentId,index]));
  const card=(change,index)=>{const ref=Domain.getFrameRef(currentContent(),change.fragmentId);const current=ref?Domain.effectiveText(ref.step,state.workspace):'';const conflict=change.originalText!=null&&current!==change.originalText&&current!==change.revisedText;const idx=frameIndex.get(change.fragmentId);const prev=idx>0?effectiveFrame(frames[idx-1].fragmentId)?.text:'';const next=idx!=null&&idx<frames.length-1?effectiveFrame(frames[idx+1].fragmentId)?.text:'';const assignment=currentAssignment(change.fragmentId);return `<article class="card pad gpt-change-card ${conflict?'has-conflict':''}" data-change-card="${index}"><div class="gpt-change-head"><strong>${Domain.escapeHtml(change.fragmentId)}</strong>${conflict?'<span class="status-badge missing">Конфликт версии</span>':'<span class="status-badge approved">Можно применить</span>'}</div><div class="gpt-context"><small>До: ${Domain.escapeHtml(prev||'—')}</small><small>После: ${Domain.escapeHtml(next||'—')}</small></div>${assignment?.assetId?`<div class="gpt-thumb"><img data-asset-src="${Domain.escapeHtml(assignment.assetId)}" data-thumbnail="true" alt=""></div>`:''}<div class="diff-grid"><div class="diff-pane before"><span>Текущий текст</span>${Domain.escapeHtml(current)}</div><div class="diff-pane after"><span>Предложение</span>${Domain.escapeHtml(change.revisedText||'')}</div></div><p class="muted">${Domain.escapeHtml(change.reason||'')}</p><div class="inline-actions"><button class="button primary small" data-accept-change="${index}" ${conflict?'disabled':''}>Принять</button><button class="button secondary small" data-reject-change="${index}">Отклонить</button>${conflict?`<button class="button secondary small" data-open-conflict="${change.fragmentId}">Открыть в Reader</button>`:''}</div></article>`;};
  openModal({kicker:'GPT DIFF',title:'Проверка исправлений',body:`<div id="candidateChanges">${(candidate.changes||[]).map(card).join('')}</div>`,footer:'<button id="acceptAllSafe" class="button secondary">Принять все без конфликтов</button><button id="candidateDone" class="button primary">Готово</button>'}); await hydrateImages($('modalBody')); $('candidateDone').onclick=closeModal;
  const acceptOne=async index=>{const change=candidate.changes[index];const ref=Domain.getFrameRef(currentContent(),change.fragmentId);if(!ref)return;const current=Domain.effectiveText(ref.step,state.workspace);if(change.originalText!=null&&current!==change.originalText&&current!==change.revisedText)return toast('Конфликт: текст изменён после отправки GPT',5000);await changeText(change.fragmentId,change.revisedText);change.decision='accepted';for(const reviewId of change.reviewIds||[])await updateReviewStatus(reviewId,'Требует проверки',{rerender:false});await DB.put('gptCandidates',{...candidate,updatedAt:Domain.now()});$('candidateChanges')?.querySelector(`[data-change-card="${index}"]`)?.classList.add('decision-done');};
  $('candidateChanges').querySelectorAll('[data-accept-change]').forEach(button=>button.onclick=()=>acceptOne(Number(button.dataset.acceptChange))); $('candidateChanges').querySelectorAll('[data-reject-change]').forEach(button=>button.onclick=async()=>{const index=Number(button.dataset.rejectChange);candidate.changes[index].decision='rejected';await DB.put('gptCandidates',{...candidate,updatedAt:Domain.now()});button.closest('article').classList.add('decision-done');}); $('candidateChanges').querySelectorAll('[data-open-conflict]').forEach(button=>button.onclick=()=>{closeModal();selectFragment(button.dataset.openConflict,{route:'reader',direct:true});}); $('acceptAllSafe').onclick=async()=>{for(let i=0;i<(candidate.changes||[]).length;i++)if(!candidate.changes[i].decision)await acceptOne(i);toast('Все изменения без конфликтов обработаны');};
}

async function renderGraphRoute() {
  if (!state.project) return renderNoProject('Граф');
  const model = buildGraph(currentContent(), state.assignments, state.reviews);
  const layout = layoutGraph(model);
  const visited = new Set((state.session?.timeline || []).map(entry => entry.sceneId));
  const modeTitle = state.graphView === 'routes' ? 'Анализ маршрутов' : state.graphView === 'metro' ? 'Схема новеллы' : 'Структура истории';
  const modeHelp = state.graphView === 'routes'
    ? 'Потоки показывают, где маршруты расходятся и к каким концовкам приводят.'
    : state.graphView === 'metro'
      ? 'Сверхкомпактная схема: главы — станции, цветные линии — сюжетные маршруты.'
      : 'Основной рабочий режим: главы идут сверху вниз, а сцены внутри каждой главы — строго слева направо.';
  view.className = 'view';
  view.innerHTML = `<section class="page full"><div class="graph-page graph-view-${state.graphView}">
    <div class="graph-modebar">
      <div class="graph-view-tabs" role="tablist" aria-label="Представление карты">
        <button class="graph-view-tab ${state.graphView === 'structure' ? 'active' : ''}" data-graph-view="structure" type="button"><strong>Структура</strong><span>Горизонтальные главы</span></button>
        <button class="graph-view-tab ${state.graphView === 'routes' ? 'active' : ''}" data-graph-view="routes" type="button"><strong>Маршруты</strong><span>Потоки веток</span></button>
        <button class="graph-view-tab ${state.graphView === 'metro' ? 'active' : ''}" data-graph-view="metro" type="button"><strong>Схема</strong><span>Metro map</span></button>
      </div>
      <div class="graph-mode-copy"><strong>${modeTitle}</strong><span>${modeHelp}</span></div>
    </div>
    <div class="graph-toolbar">
      <input id="graphSearch" class="input" placeholder="Сцена, Choice ID или название" value="${Domain.escapeHtml(state.graphSearch)}">
      <select id="graphFilter" class="select">
        <option value="all">Вся новелла</option>
        <option value="unread">Непройденные</option>
        <option value="missing">Без изображений</option>
        <option value="reviews">С замечаниями</option>
        <option value="endings">Концовки</option>
      </select>
      <div class="inline-actions graph-zoom-actions"><button id="graphZoomOut" class="button secondary small">−</button><span id="graphZoomLabel" class="status-badge">100%</span><button id="graphZoomIn" class="button secondary small">+</button><button id="graphFit" class="button secondary small">Вместить</button></div>
    </div>
    <div class="graph-body">
      <aside id="graphOutline" class="graph-outline"><div class="graph-side-head"><span class="kicker">OUTLINE</span><strong>Сцены и решения</strong><small>Двойной клик открывает сцену</small></div><div id="graphOutlineBody" class="graph-outline-body"></div></aside>
      <div id="graphViewport" class="graph-viewport" tabindex="0"><div id="graphCanvas" class="graph-canvas"></div><div id="graphMinimap" class="graph-minimap" aria-label="Миникарта"></div><div class="graph-nav-tip">Колесо — масштаб · средняя кнопка / Space+drag — перемещение</div></div>
      <aside id="graphInspector" class="graph-inspector"><span class="kicker">STORY GRAPH</span><h2>${modeTitle}</h2><p class="muted">Выберите сцену или решение на карте.</p></aside>
    </div>
  </div></section>`;
  $('graphFilter').value = state.graphFilter;
  const openNode = node => { const first = sceneFrames(sceneById(node.sceneId))[0]; if (first) selectFragment(first.fragmentId, { route: 'reader', direct: true }); };
  const selectNode = node => {
    showGraphInspector(node, model);
    state.graphNavigation?.focusNode?.(node.id);
  };
  const draw = () => {
    const svg = renderGraph($('graphCanvas'), model, layout, {
      viewMode: state.graphView,
      currentSceneId: effectiveFrame()?.sceneId,
      visitedSceneIds: visited,
      filter: state.graphFilter,
      search: state.graphSearch,
      onSelect: selectNode,
      onOpen: openNode
    });
    state.graphNavigation?.destroy?.();
    state.graphNavigation = enableGraphNavigation($('graphViewport'), svg, { initial: state.graphView === 'metro' ? .9 : .8, onZoom: zoom => { if ($('graphZoomLabel')) $('graphZoomLabel').textContent = `${Math.round(zoom * 100)}%`; const vp=$('graphViewport'); vp?.classList.toggle('semantic-low',zoom<.48); vp?.classList.toggle('semantic-mid',zoom>=.48&&zoom<.78); vp?.classList.toggle('semantic-high',zoom>=.78); } });
    if (state.graphView === 'structure') {
      renderGraphOutline($('graphOutlineBody'), model, { currentSceneId: effectiveFrame()?.sceneId, onSelect: selectNode, onOpen: openNode });
      renderGraphMinimap($('graphMinimap'), svg);
      $('graphMinimap').onclick = () => state.graphNavigation?.fit();
    }
  };
  draw();
  view.querySelectorAll('[data-graph-view]').forEach(button => button.onclick = () => { state.graphView = button.dataset.graphView; renderGraphRoute(); });
  $('graphSearch').oninput = () => { state.graphSearch = $('graphSearch').value; renderGraphRoute(); };
  $('graphFilter').onchange = () => { state.graphFilter = $('graphFilter').value; renderGraphRoute(); };
  $('graphZoomOut').onclick = () => state.graphNavigation?.zoomOut();
  $('graphZoomIn').onclick = () => state.graphNavigation?.zoomIn();
  $('graphFit').onclick = () => state.graphNavigation?.fit();
}

function showGraphInspector(node, model = null) {
  state.graphSelected = node;
  const host = $('graphInspector');
  if (!host) return;
  const outgoing = (model?.edges || []).filter(edge => edge.from === node.id);
  const incoming = (model?.edges || []).filter(edge => edge.to === node.id);
  if (node.kind === 'choice') {
    const options = outgoing.filter(edge => edge.kind === 'option');
    host.innerHTML = `<span class="kicker">РЕШЕНИЕ</span><h2>${Domain.escapeHtml(node.title)}</h2><p class="muted">${Domain.escapeHtml(node.choiceId)} · ${Domain.escapeHtml(node.chapterTitle)}</p>
      <section class="graph-inspector-section"><h3>Варианты</h3>${options.length ? options.map(edge => { const target = model?.nodes?.find(item => item.id === edge.to); return `<button class="graph-inspector-link" data-inspector-node="${Domain.escapeHtml(edge.to)}"><span>${Domain.escapeHtml(edge.label || 'Вариант')}</span><small>→ ${Domain.escapeHtml(target?.title || target?.sceneId || '')}</small></button>`; }).join('') : '<p class="muted">Переходы не определены.</p>'}</section>
      <section class="graph-inspector-section"><h3>Связи</h3><div class="graph-link-stats"><span><b>${incoming.length}</b> входов</span><span><b>${outgoing.length}</b> выходов</span></div></section>
      <button id="graphReader" class="button primary">Открыть сцену</button>`;
  } else {
    host.innerHTML = `<span class="kicker">СЦЕНА</span><h2>${Domain.escapeHtml(node.title)}</h2><p class="muted">${Domain.escapeHtml(node.sceneId)} · ${Domain.escapeHtml(node.chapterTitle)}</p>
      <div class="metric-grid graph-inspector-metrics"><div class="metric"><strong>${node.metrics.frames}</strong><span>кадров</span></div><div class="metric"><strong>${node.metrics.missing}</strong><span>без изображений</span></div><div class="metric"><strong>${node.metrics.approved}</strong><span>утверждено</span></div><div class="metric"><strong>${node.metrics.reviews}</strong><span>замечаний</span></div></div>
      <section class="graph-inspector-section"><h3>Маршрут</h3><span class="graph-route-badge route-${node.routeKey || 'common'}">${node.routeKey === 'equal' ? 'На равных' : node.routeKey === 'fire' ? 'Игра с огнём' : node.routeKey === 'mask' ? 'Без масок' : node.routeKey === 'direct' ? 'Прямой маршрут' : node.routeKey === 'oath' ? 'Старая Клятва' : node.routeKey === 'network' ? 'Новая сеть' : node.routeKey === 'break' ? 'Разрыв' : 'Общая линия'}</span><div class="graph-link-stats"><span><b>${incoming.length}</b> входов</span><span><b>${outgoing.length}</b> выходов</span></div></section>
      <div class="grid"><button id="graphReader" class="button primary">Открыть в Reader</button><button id="graphStoryboard" class="button secondary">Открыть Storyboard</button><button id="graphPreview" class="button secondary">Открыть Preview</button></div>`;
  }
  host.querySelectorAll('[data-inspector-node]').forEach(button => button.onclick = () => { const target = model?.nodes?.find(item => item.id === button.dataset.inspectorNode); if (target) { showGraphInspector(target, model); state.graphNavigation?.focusNode?.(target.id); } });
  $('graphReader').onclick = () => { const first = sceneFrames(sceneById(node.sceneId))[0]; if (first) selectFragment(first.fragmentId, { route: 'reader', direct: true }); };
  $('graphStoryboard')?.addEventListener('click', () => { state.selectedSceneId = node.sceneId; setRoute('storyboard'); });
  $('graphPreview')?.addEventListener('click', () => { const first = sceneFrames(sceneById(node.sceneId))[0]; if (first) selectFragment(first.fragmentId, { route: 'preview', direct: true }); });
}

function productionPreflight() { const validation=parser.validateNovel(Domain.applyTextEditsToContent(currentContent(),state.workspace.textEdits||{}));const metrics=Domain.projectMetrics(currentContent(),state.workspace,state.assignments,state.reviews);const criticalReviews=state.reviews.filter(review=>review.severity==='critical'&&!Domain.CLOSED_REVIEW_STATUSES.has(review.status)).length;const blockers=[];if(!validation.ok)blockers.push(`${validation.errors?.length||1} ошибок структуры`);if(metrics.missing)blockers.push(`${metrics.missing} кадров без изображения`);if(metrics.needsReview)blockers.push(`${metrics.needsReview} визуалов требуют проверки`);if(criticalReviews)blockers.push(`${criticalReviews} критичных замечаний`);return{validation,metrics,criticalReviews,blockers,ready:blockers.length===0};}

async function renderExport() {
  if (!state.project) return renderNoProject('Экспорт');
  const preflight = productionPreflight();
  const metrics = preflight.metrics;
  const estimate = state.storage || await DB.storageEstimate();
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">IMPORT / EXPORT</span><h1>Пакеты проекта</h1><p>Master DOCX, полный Project ZIP и оптимизированный runtime build.</p></div></header><div class="metric-grid">${metricsHtml(metrics)}</div><article class="card pad preflight-card ${preflight.ready ? 'ready' : 'blocked'}"><div><span class="kicker">PRODUCTION PREFLIGHT</span><h2>${preflight.ready ? 'Готово к production build' : 'Нужно устранить блокеры'}</h2><p>${preflight.ready ? 'Структура валидна, обязательные визуалы утверждены, критичных замечаний нет.' : preflight.blockers.map(item => `• ${Domain.escapeHtml(item)}`).join('<br>')}</p></div><span class="status-badge ${preflight.ready ? 'approved' : 'missing'}">${preflight.ready ? 'READY' : 'BLOCKED'}</span></article><div class="export-grid"><article class="card export-card"><h2>Project ZIP</h2><p>Полный проект: сценарий, версии, визуальный manifest, изображения, замечания и прогресс.</p><button id="exportProject" class="button primary">Скачать Project ZIP</button><button id="importProject" class="button secondary">Импортировать Project ZIP</button></article><article class="card export-card"><h2>Runtime build</h2><p>Только утверждённые тексты, изображения и интерактивная структура. Производственная сборка блокируется при missing visual.</p><button id="exportRuntime" class="button primary" ${preflight.ready ? '' : 'disabled'}>Собрать runtime</button>${preflight.ready ? '<span class="status-badge approved">Готово</span>' : '<span class="status-badge missing">Preflight blocked</span>'}<button id="exportDraftRuntime" class="button secondary">Черновой runtime с placeholders</button></article><article class="card export-card"><h2>Master DOCX</h2><p>Актуальный текст сценария с устойчивыми Fragment ID.</p><button id="exportDocx" class="button primary">Скачать DOCX</button><button id="exportJson" class="button secondary">Скачать HEARTLINE JSON</button></article><article class="card export-card"><h2>Отчёты</h2><p>CSV замечаний и проверка качества визуалов.</p><button id="exportReviews" class="button secondary">Замечания CSV</button><button id="exportQuality" class="button secondary">Quality report JSON</button></article><article class="card export-card"><h2>Локальное хранилище</h2><p>Использовано: ${estimate?.usage ? `${Math.round(estimate.usage / 1024 / 1024)} МБ` : 'н/д'} из ${estimate?.quota ? `${Math.round(estimate.quota / 1024 / 1024)} МБ` : 'н/д'}.</p><button id="persistStorage" class="button secondary">Запросить persistent storage</button></article></div></section>`;
  $('exportProject').onclick = exportProjectZip;
  $('importProject').onclick = () => { $('projectImportInput').value = ''; $('projectImportInput').click(); };
  $('exportRuntime').onclick = () => exportRuntimeZip(false);
  $('exportDraftRuntime').onclick = () => exportRuntimeZip(true);
  $('exportDocx').onclick = () => {
    const content = Domain.applyTextEditsToContent(currentContent(), state.workspace.textEdits || {});
    exporter.downloadMasterDocx(content, {}, `${Domain.slug(state.project.title)}_${Domain.slug(state.version.label)}.docx`);
  };
  $('exportJson').onclick = () => exporter.downloadJson(Domain.applyTextEditsToContent(currentContent(), state.workspace.textEdits || {}), `${Domain.slug(state.project.title)}.json`);
  $('exportReviews').onclick = exportReviewsCsv;
  $('exportQuality').onclick = () => exporter.downloadJson({ schema: 'heartline-quality-report-v3', projectId: state.project.projectId, versionId: state.version.versionId, generatedAt: Domain.now(), metrics, missingFragments: currentFrames().filter(frame => !currentAssignment(frame.fragmentId)?.assetId).map(frame => frame.fragmentId), needsReview: state.assignments.filter(item => item.status === 'needs-review').map(item => item.fragmentId) }, `${Domain.slug(state.project.title)}_quality.json`);
  $('persistStorage').onclick = async () => toast(await DB.requestPersistentStorage() ? 'Persistent storage разрешён' : 'Браузер не предоставил persistent storage');
}

async function exportProjectZip() {
  toast('Собираю Project ZIP…', 5000);
  const metadata = await DB.exportDatabaseMetadata(state.project.projectId);
  const entries = [
    { name: 'project.json', data: JSON.stringify({ schema: 'heartline-project-v3', project: metadata.project, activeVersionId: state.version.versionId, exportedAt: Domain.now() }, null, 2) },
    { name: 'novel.json', data: JSON.stringify(Domain.applyTextEditsToContent(currentContent(), state.workspace.textEdits || {}), null, 2) },
    { name: 'metadata.json', data: JSON.stringify(metadata, null, 2) },
    { name: 'visual-manifest.json', data: JSON.stringify(state.assignments, null, 2) },
    { name: 'reviews.json', data: JSON.stringify(state.reviews, null, 2) },
    { name: 'README.txt', data: 'HEARTLINE Editor 3.1 Project ZIP. Импортируйте через Экспорт → Project ZIP.' }
  ];
  for (const asset of state.assets) entries.push({ name: `assets/${asset.assetId}.${asset.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin'}`, data: new Uint8Array(await asset.blob.arrayBuffer()) });
  exporter.downloadBytes(exporter.createZip(entries), `${Domain.slug(state.project.title)}_project_v3.zip`, 'application/zip');
  toast('Project ZIP готов');
}

async function exportRuntimeZip(draft) {
  const missing = currentFrames().filter(frame => !currentAssignment(frame.fragmentId)?.assetId);
  if (missing.length && !draft) return toast(`Runtime заблокирован: ${missing.length} кадров без изображения`);
  toast('Собираю runtime…', 5000);
  const content = Domain.applyTextEditsToContent(currentContent(), state.workspace.textEdits || {});
  const manifest = {};
  const entries = [];
  const usedAssets = new Set();
  for (const assignment of state.assignments) {
    manifest[assignment.fragmentId] = { assetId: assignment.assetId, fit: assignment.fit, focalPoint: assignment.focalPoint, zoom: assignment.zoom, overlayOpacity: assignment.overlayOpacity, deviceOverrides: assignment.deviceOverrides, status: assignment.status };
    if (assignment.assetId) usedAssets.add(assignment.assetId);
  }
  for (const assetId of usedAssets) {
    const asset = state.assetMap.get(assetId);
    if (!asset) continue;
    const extension = asset.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
    manifest.__assets ||= {};
    manifest.__assets[assetId] = `assets/${assetId}.${extension}`;
    entries.push({ name: `assets/${assetId}.${extension}`, data: new Uint8Array(await asset.blob.arrayBuffer()) });
  }
  const runtime = { schema: 'heartline-runtime-v3', title: state.project.title, versionId: state.version.versionId, builtAt: Domain.now(), draft, novel: content, visualManifest: manifest };
  const [engineSource, domainSource, playerSource] = await Promise.all([fetch('./heartline-engine.js').then(r => r.text()), fetch('./heartline-domain.js').then(r => r.text()), fetch('./heartline-player-renderer.js').then(r => r.text())]);
  entries.push(
    { name: 'runtime.json', data: JSON.stringify(runtime) },
    { name: 'engine.js', data: engineSource },
    { name: 'domain.js', data: domainSource },
    { name: 'player-renderer.js', data: playerSource },
    { name: 'index.html', data: runtimeIndexHtml() },
    { name: 'runtime-player.js', data: runtimePlayerJs() },
    { name: 'runtime.css', data: runtimeCss() }
  );
  exporter.downloadBytes(exporter.createZip(entries), `${Domain.slug(state.project.title)}_runtime${draft ? '_draft' : ''}.zip`, 'application/zip');
  toast('Runtime build готов');
}

function runtimeIndexHtml() { return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>HEARTLINE</title><link rel="stylesheet" href="runtime.css"></head><body><main id="player"></main><script type="module" src="runtime-player.js"></script></body></html>`; }
function runtimeCss() { return `*{box-sizing:border-box}html,body,#player{margin:0;width:100%;height:100%;overflow:hidden;background:#111;font-family:Inter,Arial,sans-serif}.player-device.runtime-bare{position:relative;border:0;border-radius:0;background:#111;overflow:hidden}.player-screen{position:relative;width:100%;height:100%;overflow:hidden;background:#ddd}.player-image{position:absolute;inset:0;width:100%;height:100%;display:block}.player-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:40px;background:linear-gradient(145deg,#dddeda,#cfd1cc);color:#60625e;gap:9px}.player-placeholder-mark{width:52px;height:52px;border-radius:16px;background:#202020;color:white;display:grid;place-items:center;font-weight:800;font-size:22px}.player-placeholder span{max-width:250px;font-size:12px}.player-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15),transparent 26%,transparent 52%,rgba(0,0,0,.5) 100%);pointer-events:none}.player-scene-label{position:absolute;left:16px;right:16px;top:calc(var(--safe-top) + 10px);display:flex;justify-content:space-between;color:white;text-shadow:0 1px 8px rgba(0,0,0,.75);font-size:10px}.player-scene-label span{font-weight:850;letter-spacing:.12em}.player-scene-label strong{max-width:62%;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.player-dialogue-panel{position:absolute;left:12px;right:12px;bottom:calc(var(--safe-bottom) + 10px);border-radius:18px;padding:15px 16px 16px;background:rgba(255,255,255,calc(.76 + var(--overlay)));box-shadow:0 10px 30px rgba(0,0,0,.18);backdrop-filter:blur(18px);color:#171717}.player-dialogue-panel.thought .player-current-text,.player-dialogue-panel.narration .player-current-text{font-family:Georgia,"Times New Roman",serif;font-style:italic}.player-speaker{font-size:10px;font-weight:850;letter-spacing:.08em;margin-bottom:7px}.player-current-text{font-size:var(--frame-font);line-height:1.42;white-space:pre-wrap}.player-options{display:grid;gap:8px;margin-top:12px}.player-option{border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.78);border-radius:11px;padding:10px 11px;text-align:left;font-size:calc(var(--frame-font) * .82)}.runtime-next{position:absolute;inset:0;border:0;background:transparent}`; }
function runtimePlayerJs() { return `import {StoryEngine,createSession} from './engine.js';\nimport {renderPlayerFrame} from './player-renderer.js';\nconst data=await fetch('./runtime.json').then(r=>r.json());const host=document.getElementById('player');const session=createSession('runtime',data.versionId,data.novel);const engine=new StoryEngine(data.novel,session);engine.advance();function ref(id){for(const s of data.novel.scenes){const stack=[...(s.steps||[])];while(stack.length){const x=stack.shift();if(x.fragmentId===id)return{x,s};if(x.type==='choice')for(const o of x.options||[])stack.push(...(o.steps||[]));}}}function draw(){const e=engine.currentEntry();if(!e)return;const r=ref(e.fragmentId);if(!r)return;const st=r.x,m=data.visualManifest[e.fragmentId]||{},path=m.assetId?data.visualManifest.__assets?.[m.assetId]:null;const frame={fragmentId:e.fragmentId,sceneId:r.s.id,sceneTitle:r.s.title,type:st.type,speaker:st.speaker||'',text:st.type==='choice'?(st.prompt||''):(st.text||''),options:st.type==='choice'?(st.options||[]).map(o=>({id:o.id,label:o.label})):[],visualPrompt:r.s.title,assignment:m,asset:null};const device={id:'runtime',label:'Runtime',width:window.innerWidth,height:window.innerHeight,safeTop:Math.max(20,Number(getComputedStyle(document.documentElement).getPropertyValue('--sat')||0)),safeBottom:24,fontSize:Math.max(16,Math.min(20,window.innerWidth/22))};renderPlayerFrame(host,{frame,device,orientation:window.innerWidth>window.innerHeight?'landscape':'portrait',assetUrl:path,scaleToFit:false,bare:true,showStatusBar:false,onChoose:id=>{engine.choose(id);draw()}});if(st.type!=='choice'){const next=document.createElement('button');next.className='runtime-next';next.setAttribute('aria-label','Далее');next.onclick=()=>{engine.forward();draw()};host.querySelector('.player-screen').append(next)}}window.addEventListener('resize',draw);draw();`; }

function exportReviewsCsv() {
  const rows = state.reviews.map(review => ({ reviewId: review.reviewId, targetType: review.targetType, fragmentId: review.fragmentId, category: review.category, severity: review.severity, status: review.status, comment: review.comment, quotedText: review.quotedText || '' }));
  exporter.downloadText(exporter.toCsv(rows, [{ key: 'reviewId', label: 'Review ID' }, { key: 'targetType', label: 'Цель' }, { key: 'fragmentId', label: 'Fragment ID' }, { key: 'category', label: 'Категория' }, { key: 'severity', label: 'Важность' }, { key: 'status', label: 'Статус' }, { key: 'comment', label: 'Комментарий' }, { key: 'quotedText', label: 'Цитата' }]), `${Domain.slug(state.project.title)}_reviews.csv`, 'text/csv;charset=utf-8');
}

async function render() {
  $('undoButton').disabled = !(state.workspace?.undoStack?.length);
  $('redoButton').disabled = !(state.workspace?.redoStack?.length);
  switch (state.route) {
    case 'library': return renderLibrary();
    case 'reader': return renderReader();
    case 'storyboard': return renderStoryboard();
    case 'assets': return renderAssets();
    case 'preview': return renderPreview();
    case 'reviews': return renderReviews();
    case 'versions': return renderVersions();
    case 'gpt': return renderGpt();
    case 'graph': return renderGraphRoute();
    case 'export': return renderExport();
    default: return renderLibrary();
  }
}

async function handleNovelImport(files) {
  try {
    toast('Импортирую сценарий…', 5000);
    const imported = await parser.importFiles(files);
    const content = imported.novel;
    const projectId = `${Domain.slug(content.title)}-${Date.now().toString(36)}`;
    content.id = projectId;
    const versionId = `${projectId}::import-${Date.now().toString(36)}`;
    const project = { projectId, title: content.title, activeVersionId: versionId, createdAt: Domain.now(), updatedAt: Domain.now() };
    const version = { versionId, projectId, label: 'Импорт сценария', parentVersionId: null, sourceType: imported.report.format, createdAt: Domain.now(), updatedAt: Domain.now(), content, validation: imported.validation };
    await DB.put('projects', project); await DB.put('versions', version);
    await DB.put('workspaceDrafts', { projectId, baseVersionId: versionId, textEdits: {}, selectedFragmentId: null, selectedSceneId: content.startScene, undoStack: [], redoStack: [], dirty: false, updatedAt: Domain.now() });
    await DB.ensureVisualAssignments(projectId, DB.versionScope(versionId), content);
    await DB.ensureVisualAssignments(projectId, DB.workspaceScope(projectId), content);
    toast(`Импортировано: ${imported.report.scenes} сцен, ${imported.report.fragments} кадров`);
    await loadCollections();
    await openProject(projectId);
  } catch (error) { toast(error.message, 5000); }
}

async function handleFrameAsset(file) {
  if (!file || !state.selectedFragmentId) return;
  try {
    toast('Обрабатываю изображение…', 5000);
    const result = await Assets.importAsset(state.project.projectId, file);
    const before = currentAssignment();
    const after = { ...before, assetId: result.asset.assetId, status: before.status === 'approved' ? 'needs-review' : 'draft', updatedAt: Domain.now() };
    await applyAssignmentChange(state.selectedFragmentId, after, 'replace image');
    state.assetMap.set(result.asset.assetId, result.asset);
    if (!state.assets.find(asset => asset.assetId === result.asset.assetId)) state.assets.push(result.asset);
    toast(result.duplicate ? 'Использован существующий Asset' : 'Изображение добавлено');
    await render();
  } catch (error) { toast(error.message, 5000); }
}

async function handleAssetInput(files, mode) {
  try {
    let imageFiles = Array.from(files || []);
    if (imageFiles.length === 1 && imageFiles[0].name.toLowerCase().endsWith('.zip')) imageFiles = await Assets.imageFilesFromZip(imageFiles[0]);
    toast(`Импорт изображений: ${imageFiles.length}`, 5000);
    const results = await Assets.importAssets(state.project.projectId, imageFiles, { matchFrames: currentFrames(), scopeId: workspaceScope() });
    await refreshProjectData();
    const matched = results.filter(result => result.matchedFragmentId).length;
    toast(`Добавлено ${results.length}; автоматически назначено ${matched}`);
    if (mode === 'batch-storyboard') renderStoryboard(); else renderAssets();
  } catch (error) { toast(error.message, 5000); }
}

async function handleGptImport(file) {
  try {
    let payload;
    if (file.name.toLowerCase().endsWith('.zip')) {
      const zip = new parser.MiniZip(await file.arrayBuffer());
      const entry = zip.list().find(item => /(^|\/)revision\.json$/i.test(item.name)) || zip.list().find(item => item.name.toLowerCase().endsWith('.json'));
      if (!entry) throw new Error('В ZIP нет revision.json');
      payload = JSON.parse(new TextDecoder().decode(await zip.read(entry)));
    } else payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.changes)) throw new Error('Файл не содержит changes[]');
    const candidate = { candidateId: Domain.uid('candidate'), projectId: state.project.projectId, baseVersionId: payload.baseVersionId || state.version.versionId, label: file.name, status: 'Требует проверки', changes: payload.changes, createdAt: Domain.now(), updatedAt: Domain.now() };
    await DB.put('gptCandidates', candidate);
    toast(`Импортировано ${candidate.changes.length} изменений`);
    renderGpt();
  } catch (error) { toast(error.message, 5000); }
}

async function importProjectZip(file) {
  try {
    toast('Импортирую Project ZIP…', 7000);
    const zip = new parser.MiniZip(await file.arrayBuffer());
    const projectEntry = zip.list().find(entry => /(^|\/)project\.json$/i.test(entry.name));
    const novelEntry = zip.list().find(entry => /(^|\/)novel\.json$/i.test(entry.name));
    const metadataEntry = zip.list().find(entry => /(^|\/)metadata\.json$/i.test(entry.name));
    const manifestEntry = zip.list().find(entry => /(^|\/)visual-manifest\.json$/i.test(entry.name));
    const reviewsEntry = zip.list().find(entry => /(^|\/)reviews\.json$/i.test(entry.name));
    if (!projectEntry || !novelEntry) throw new Error('Это не HEARTLINE Project ZIP');
    const decodeJson = async entry => JSON.parse(new TextDecoder().decode(await zip.read(entry)));
    const projectPayload = await decodeJson(projectEntry);
    const fallbackContent = parser.normalizeNovel(await decodeJson(novelEntry));
    const metadata = metadataEntry ? await decodeJson(metadataEntry) : null;
    const originalProject = metadata?.project || projectPayload.project || {};
    const originalProjectId = originalProject.projectId || fallbackContent.id || Domain.slug(fallbackContent.title);
    const projectId = !(await DB.get('projects', originalProjectId)) ? originalProjectId : `${Domain.slug(fallbackContent.title)}-${Date.now().toString(36)}`;
    const versionIdMap = new Map();
    const sourceVersions = metadata?.versions?.length ? metadata.versions : [{
      versionId: projectPayload.activeVersionId || `${originalProjectId}::project-import`,
      projectId: originalProjectId,
      label: 'Импорт Project ZIP',
      parentVersionId: null,
      sourceType: 'project-zip-v3',
      createdAt: Domain.now(),
      updatedAt: Domain.now(),
      content: fallbackContent,
      validation: parser.validateNovel(fallbackContent)
    }];
    sourceVersions.forEach((version, index) => {
      const mapped = projectId === originalProjectId
        ? version.versionId
        : `${projectId}::${Domain.slug(version.label || `version-${index + 1}`)}-${index + 1}`;
      versionIdMap.set(version.versionId, mapped);
    });
    const versions = sourceVersions.map(version => ({
      ...Domain.clone(version),
      versionId: versionIdMap.get(version.versionId),
      projectId,
      parentVersionId: version.parentVersionId ? versionIdMap.get(version.parentVersionId) || null : null,
      content: parser.normalizeNovel(version.content || fallbackContent),
      sourceType: version.sourceType || 'project-zip-v3',
      updatedAt: version.updatedAt || Domain.now()
    }));
    const originalActiveVersionId = metadata?.project?.activeVersionId || projectPayload.activeVersionId || sourceVersions.at(-1).versionId;
    const activeVersionId = versionIdMap.get(originalActiveVersionId) || versions.at(-1).versionId;
    const activeVersion = versions.find(version => version.versionId === activeVersionId) || versions.at(-1);
    const project = {
      ...Domain.clone(originalProject),
      projectId,
      title: originalProject.title || activeVersion.content.title,
      activeVersionId: activeVersion.versionId,
      createdAt: originalProject.createdAt || Domain.now(),
      updatedAt: Domain.now(),
      importedAt: Domain.now()
    };
    await DB.put('projects', project);
    await DB.putMany('versions', versions);

    const assetEntries = zip.list().filter(entry => /^assets\//.test(entry.name) && /\.(png|jpe?g|webp|avif)$/i.test(entry.name));
    const importedAssetIds = new Map();
    for (const entry of assetEntries) {
      const bytes = await zip.read(entry);
      const extension = entry.name.split('.').pop().toLowerCase();
      const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' })[extension];
      const fileObject = new File([bytes], entry.name.split('/').pop(), { type: mime });
      const result = await Assets.importAsset(projectId, fileObject, { source: 'project-import' });
      const oldAssetId = entry.name.split('/').pop().replace(/\.[^.]+$/, '');
      importedAssetIds.set(oldAssetId, result.asset.assetId);
    }
    if (originalProject.coverAssetId) {
      project.coverAssetId = importedAssetIds.get(originalProject.coverAssetId) || null;
      await DB.put('projects', project);
    }

    const remapScope = scopeId => {
      if (!scopeId) return DB.workspaceScope(projectId);
      if (scopeId.startsWith('workspace:')) return DB.workspaceScope(projectId);
      if (scopeId.startsWith('version:')) {
        const oldVersionId = scopeId.slice('version:'.length);
        return DB.versionScope(versionIdMap.get(oldVersionId) || activeVersion.versionId);
      }
      return scopeId;
    };
    const sourceAssignments = metadata?.assignments?.length
      ? metadata.assignments
      : manifestEntry ? await decodeJson(manifestEntry) : [];
    const assignmentsArray = Array.isArray(sourceAssignments) ? sourceAssignments : Object.values(sourceAssignments || {});
    const remappedAssignments = assignmentsArray.filter(item => item?.fragmentId).map(item => {
      const scopeId = remapScope(item.scopeId);
      const assetId = importedAssetIds.get(item.assetId) || (item.assetId && [...importedAssetIds.values()].includes(item.assetId) ? item.assetId : null);
      return {
        ...Domain.clone(item),
        projectId,
        scopeId,
        assignmentId: DB.visualAssignmentId(scopeId, item.fragmentId),
        assetId,
        status: assetId ? (item.status || 'draft') : 'missing',
        updatedAt: Domain.now()
      };
    });
    if (remappedAssignments.length) {
      for (let index = 0; index < remappedAssignments.length; index += 500) await DB.putMany('visualAssignments', remappedAssignments.slice(index, index + 500));
    }
    for (const version of versions) await DB.ensureVisualAssignments(projectId, DB.versionScope(version.versionId), version.content);
    await DB.ensureVisualAssignments(projectId, DB.workspaceScope(projectId), activeVersion.content);

    const sourceWorkspace = metadata?.workspace || {};
    const workspace = {
      projectId,
      baseVersionId: activeVersion.versionId,
      textEdits: Domain.clone(sourceWorkspace.textEdits || {}),
      selectedFragmentId: sourceWorkspace.selectedFragmentId || null,
      selectedSceneId: sourceWorkspace.selectedSceneId || activeVersion.content.startScene,
      undoStack: [],
      redoStack: [],
      dirty: Boolean(sourceWorkspace.dirty),
      updatedAt: Domain.now()
    };
    await DB.put('workspaceDrafts', workspace);

    const sourceReviews = metadata?.reviews?.length ? metadata.reviews : reviewsEntry ? await decodeJson(reviewsEntry) : [];
    const reviews = (Array.isArray(sourceReviews) ? sourceReviews : []).map(review => ({
      ...Domain.clone(review),
      reviewId: review.reviewId || Domain.uid('review'),
      projectId,
      versionId: versionIdMap.get(review.versionId) || activeVersion.versionId,
      visualId: review.fragmentId ? DB.visualAssignmentId(DB.workspaceScope(projectId), review.fragmentId) : null,
      updatedAt: review.updatedAt || Domain.now()
    }));
    if (reviews.length) await DB.putMany('reviews', reviews);

    const sessions = (metadata?.sessions || []).map(session => ({
      ...Domain.clone(session),
      sessionId: `session:${projectId}:${versionIdMap.get(session.versionId) || activeVersion.versionId}${session.archived ? `:archive:${Date.now().toString(36)}` : ''}`,
      projectId,
      versionId: versionIdMap.get(session.versionId) || activeVersion.versionId
    }));
    if (sessions.length) await DB.putMany('sessions', sessions);
    if (!sessions.some(session => session.versionId === activeVersion.versionId && !session.archived)) {
      await DB.put('sessions', createSession(projectId, activeVersion.versionId, activeVersion.content));
    }
    const candidates = (metadata?.candidates || []).map(candidate => ({ ...Domain.clone(candidate), candidateId: candidate.candidateId || Domain.uid('candidate'), projectId, baseVersionId: versionIdMap.get(candidate.baseVersionId) || activeVersion.versionId }));
    const cycles = (metadata?.cycles || []).map(cycle => ({ ...Domain.clone(cycle), cycleId: cycle.cycleId || Domain.uid('cycle'), projectId }));
    if (candidates.length) await DB.putMany('gptCandidates', candidates);
    if (cycles.length) await DB.putMany('gptCycles', cycles);

    await loadCollections();
    toast(`Project ZIP импортирован: ${versions.length} версий, ${assetEntries.length} изображений`);
    await openProject(projectId);
  } catch (error) { toast(error.message, 7000); }
}

function wireGlobal() {
  document.addEventListener('selectionchange', captureSelection);
  const syncVisualViewport = () => document.documentElement.style.setProperty('--reader-vvh', `${Math.round(window.visualViewport?.height || window.innerHeight)}px`);
  syncVisualViewport();
  window.visualViewport?.addEventListener('resize', syncVisualViewport);
  window.addEventListener('orientationchange', () => setTimeout(syncVisualViewport, 80));
  document.querySelectorAll('[data-route]').forEach(button => button.onclick = () => setRoute(button.dataset.route));
  $('mobileMoreButton')?.addEventListener('click', openMobileMoreMenu);
  $('brandButton').onclick = () => setRoute('library');
  $('modalClose').onclick = closeModal;
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  $('undoButton').onclick = undo;
  $('redoButton').onclick = redo;
  $('novelInput').onchange = () => $('novelInput').files.length && handleNovelImport($('novelInput').files);
  $('frameAssetInput').onchange = () => handleFrameAsset($('frameAssetInput').files[0]);
  $('coverInput').onchange = () => $('coverInput').files[0] && handleProjectCover($('coverInput').files[0]);
  $('assetInput').onchange = () => $('assetInput').files.length && handleAssetInput($('assetInput').files, $('assetInput').dataset.mode || 'library');
  $('gptInput').onchange = () => $('gptInput').files[0] && handleGptImport($('gptInput').files[0]);
  $('projectImportInput').onchange = () => $('projectImportInput').files[0] && importProjectZip($('projectImportInput').files[0]);
  window.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select') || modal.open) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (state.route === 'reader') {
      if (event.key === 'ArrowLeft') view.querySelector('[data-reader-action="back"]')?.click();
      if (event.key === 'ArrowRight') view.querySelector('[data-reader-action="forward"]')?.click();
      if (event.key.toLowerCase() === 'c') openReviewForm({ targetType: 'text' });
      if (event.key.toLowerCase() === 'e') { state.inspectorTab = 'frame'; isMobileReader() ? openMobileFrameEditor(effectiveFrame()) : refreshReaderContent({ resetScroll: false }); }
      if (event.key.toLowerCase() === 'i') { state.inspectorTab = 'image'; refreshReaderContent({ resetScroll: false }); }
      if (event.key.toLowerCase() === 'p') setRoute('preview');
      if (event.key.toLowerCase() === 'a') approveCurrentVisual();
    }
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.deferredInstall = event; $('installButton').classList.remove('hidden'); });
  $('installButton').onclick = async () => { if (!state.deferredInstall) return; state.deferredInstall.prompt(); await state.deferredInstall.userChoice; state.deferredInstall = null; $('installButton').classList.add('hidden'); };
}

async function approveCurrentVisual() {
  const assignment = currentAssignment();
  if (!assignment?.assetId) return toast('Сначала назначьте изображение');
  const after = { ...assignment, status: 'approved', approvedAt: Domain.now(), updatedAt: Domain.now() };
  await applyAssignmentChange(state.selectedFragmentId, after, 'approve visual');
  toast('Визуал утверждён');
  refreshActiveRoute({ resetReaderScroll: false });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  try { await navigator.serviceWorker.register('./sw.js'); } catch (error) { console.warn('Service Worker:', error); }
}

async function init() {
  wireGlobal();
  try {
    await DB.openDb();
    await DB.migrateFromV2IfNeeded();
    await ensureBuiltinProjects();
    await loadCollections();
    await registerServiceWorker();
    await renderLibrary();
  } catch (error) {
    console.error(error);
    view.innerHTML = `<section class="page"><div class="empty-state"><div><h2>Не удалось запустить HEARTLINE v3</h2><p>${Domain.escapeHtml(error.message || String(error))}</p><button id="retryStart" class="button primary">Повторить запуск</button></div></div></section>`;
    $('retryStart').onclick = () => location.reload();
  }
}

init();
