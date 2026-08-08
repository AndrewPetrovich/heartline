import * as DB from './heartline-v301-db.js';
import * as Domain from './heartline-v301-domain.js';
import { StoryEngine, createSession } from './heartline-v301-engine.js';
import * as Assets from './heartline-v301-assets.js';
import { DEVICE_PRESETS, renderPlayerFrame, renderDeviceComparison, orientedDevice } from './heartline-v301-player-renderer.js';
import { buildGraph, layoutGraph, renderGraph, renderGraphOutline, renderGraphMinimap, enableGraphNavigation } from './heartline-v303-graph.js';

const $ = id => document.getElementById(id);
const view = $('view');
const modal = $('modal');
const exporter = window.HEARTLINEExporter;
const parser = window.HEARTLINEParser;

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
  storyboardFilter: 'all',
  storyboardSelection: new Set(),
  assetSearch: '',
  reviewFilter: 'open',
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
}

async function setRoute(route) {
  if (route !== 'preview') state.previewDraftAssignment = null;
  state.route = route;
  setActiveNav(route);
  await render();
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

async function loadCollections() {
  state.projects = (await DB.getAll('projects')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  state.storage = await DB.storageEstimate();
}

async function ensureBuiltinProject() {
  if ((await DB.getAll('projects')).length) return;
  const response = await fetch('./novel.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Не удалось загрузить встроенную новеллу');
  const content = parser.normalizeNovel(await response.json());
  const projectId = content.id || 'poslednyaya-podacha';
  const versionId = `${projectId}::${Domain.slug(content.contentVersion || 'bible-v3-final')}`;
  const createdAt = Domain.now();
  const validation = parser.validateNovel(content);
  const project = { projectId, title: content.title, activeVersionId: versionId, createdAt, updatedAt: createdAt };
  const version = { versionId, projectId, label: content.contentVersion || 'Bible v3 Final', parentVersionId: null, sourceType: 'builtin', createdAt, updatedAt: createdAt, content, validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, stats: validation.stats } };
  const workspace = { projectId, baseVersionId: versionId, textEdits: {}, selectedFragmentId: null, selectedSceneId: content.startScene, undoStack: [], redoStack: [], dirty: false, updatedAt: createdAt };
  await DB.putMany('projects', [project]);
  await DB.putMany('versions', [version]);
  await DB.put('workspaceDrafts', workspace);
  await DB.ensureVisualAssignments(projectId, DB.versionScope(versionId), content);
  await DB.ensureVisualAssignments(projectId, DB.workspaceScope(projectId), content);
}

async function openProject(projectId, { route = 'reader' } = {}) {
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
  state.selectedFragmentId = workspace.selectedFragmentId;
  state.selectedSceneId = workspace.selectedSceneId || state.version.content.startScene;
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
  state.project.updatedAt = Domain.now();
  await DB.put('projects', state.project);
  await persistWorkspaceSelection();
  await setRoute(route);
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
  if (route) await setRoute(route); else await render();
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
  toast('Текст сохранён. Утверждённый визуал переведён в проверку.');
  await render();
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
  await render();
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
  await render();
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
    closeModal();
    toast('Замечание сохранено');
    await render();
  };
}

async function updateReviewStatus(reviewId, status) {
  const review = state.reviews.find(item => item.reviewId === reviewId);
  if (!review) return;
  review.status = status;
  review.updatedAt = Domain.now();
  await DB.put('reviews', review);
  await render();
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

async function renderLibrary() {
  await loadCollections();
  view.className = 'view';
  view.innerHTML = `<section class="page">
    <header class="page-header"><div><span class="kicker">HEARTLINE EDITOR V3</span><h1>Проекты новелл</h1><p>Текст, изображения, ветвления и мобильная композиция в одном рабочем цикле.</p></div>
    <div class="header-actions"><button id="importNovelButton" class="button secondary">Импорт сценария</button><button id="importProjectButton" class="button primary">Импорт Project ZIP</button></div></header>
    <div class="project-list">${state.projects.map(project => `<article class="card project-card"><div><span class="kicker">ПРОЕКТ</span><h2>${Domain.escapeHtml(project.title)}</h2></div><div class="project-card-meta"><span>${Domain.escapeHtml(project.activeVersionId)}</span><span>${Domain.formatDate(project.updatedAt)}</span></div><div class="project-card-actions"><button class="button primary" data-open-project="${Domain.escapeHtml(project.projectId)}">Открыть</button></div></article>`).join('')}</div>
    ${state.projects.length ? '' : '<div class="empty-state"><div><h2>Библиотека пуста</h2><p>Импортируйте DOCX, JSON или Project ZIP.</p></div></div>'}
  </section>`;
  $('importNovelButton').onclick = () => { $('novelInput').value = ''; $('novelInput').click(); };
  $('importProjectButton').onclick = () => { $('projectImportInput').value = ''; $('projectImportInput').click(); };
  view.querySelectorAll('[data-open-project]').forEach(button => button.onclick = () => openProject(button.dataset.openProject));
}

function readerSceneTree() {
  const groups = Domain.chapterGroups(currentContent());
  return groups.map(group => `<section class="chapter-block"><div class="chapter-title"><span>${Domain.escapeHtml(group.title)}</span><span>${group.scenes.length}</span></div>${group.scenes.map(scene => {
    const metrics = Domain.sceneFrameMetrics(currentContent(), scene.id, state.assignments, state.reviews);
    return `<button class="scene-link ${scene.id === state.selectedSceneId ? 'active' : ''}" data-scene-id="${Domain.escapeHtml(scene.id)}"><span>${Domain.escapeHtml(scene.id)} · ${Domain.escapeHtml(scene.title)}</span><span class="scene-status">${metrics.missing ? '<i class="status-dot danger" title="Есть кадры без изображения"></i>' : metrics.needsReview ? '<i class="status-dot warn"></i>' : '<i class="status-dot good"></i>'}</span></button>`;
  }).join('')}</section>`).join('');
}

function readerCurrentHtml() {
  const frame = effectiveFrame();
  if (!frame) return '<div class="empty-state"><div><h2>Кадр не выбран</h2><p>Выберите сцену или начните прохождение.</p></div></div>';
  const frames = currentFrames();
  const index = frames.findIndex(item => item.fragmentId === frame.fragmentId);
  const context = frames.slice(Math.max(0, index - 2), index).map(item => {
    const ref = Domain.getFrameRef(currentContent(), item.fragmentId);
    return `<div class="context-frame ${ref.step.type}">${Domain.escapeHtml(Domain.effectiveText(ref.step, state.workspace))}</div>`;
  }).join('');
  const entry = activeEntry();
  const selectedOptionId = entry?.kind === 'choice' ? entry.selectedOptionId : null;
  const options = frame.type === 'choice' ? `<div class="choice-options">${frame.options.map(option => `<button class="choice-option ${selectedOptionId === option.id ? 'selected' : ''}" data-choice-option="${Domain.escapeHtml(option.id)}" ${state.directFragmentId ? 'data-direct-choice="true"' : ''}>${Domain.escapeHtml(option.label)}${selectedOptionId === option.id ? ' ✓' : ''}</button>`).join('')}</div>` : '';
  return `<div class="scene-cue"><strong>${Domain.escapeHtml(frame.sceneTitle)}</strong><span>${Domain.escapeHtml(frame.visualPrompt || frame.sceneId)}</span></div>
    <div class="reading-column">${context}<article class="current-frame ${frame.type}"><div class="frame-actions"><button class="mini-button" id="commentCurrent" title="Комментарий">💬</button><button class="mini-button" id="editCurrent" title="Редактировать">✎</button></div>${frame.speaker ? `<span class="speaker">${Domain.escapeHtml(frame.speaker)}</span>` : ''}<div class="frame-text" data-frame-text="${Domain.escapeHtml(frame.fragmentId)}">${Domain.escapeHtml(frame.text)}</div>${options}</article></div>`;
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

async function renderReader() {
  if (!state.project) return renderNoProject('reader');
  syncSelectedWithEngine();
  const frame = effectiveFrame();
  view.className = 'view';
  view.innerHTML = `<section class="page full"><div class="reader-layout">
    <aside class="reader-sidebar"><div class="reader-pane-head"><h2>${Domain.escapeHtml(state.project.title)}</h2><p>${Domain.escapeHtml(state.version.label)}</p></div><div class="scene-search"><input id="sceneSearch" class="input" placeholder="Сцена или ID"></div><div id="sceneTree" class="scene-tree">${readerSceneTree()}</div></aside>
    <section class="reader-center"><header class="reader-toolbar"><button id="toggleScenes" class="button secondary small">Структура</button><div class="reader-title"><strong>${frame ? Domain.escapeHtml(`${frame.chapterTitle} · ${frame.sceneTitle}`) : 'Кадр не выбран'}</strong><span>${frame ? Domain.escapeHtml(`${frame.fragmentId} · ${Domain.textTypeLabel(frame.type)}`) : ''}</span></div><div class="inline-actions"><button id="openPreviewTop" class="button secondary small">Превью</button><button id="toggleInspector" class="button secondary small">Инспектор</button></div></header><div id="readerScroll" class="reader-scroll">${readerCurrentHtml()}</div><footer class="reader-bottom"><button id="firstFrame" class="button secondary">Первая</button><button id="backFrame" class="button secondary">← Назад</button><button id="forwardFrame" class="button primary">Вперёд →</button><button id="lastFrame" class="button secondary">Последняя</button></footer></section>
    <aside class="reader-inspector"><div class="inspector-tabs"><button class="inspector-tab ${state.inspectorTab === 'frame' ? 'active' : ''}" data-inspector-tab="frame">Кадр</button><button class="inspector-tab ${state.inspectorTab === 'image' ? 'active' : ''}" data-inspector-tab="image">Изображение</button><button class="inspector-tab ${state.inspectorTab === 'reviews' ? 'active' : ''}" data-inspector-tab="reviews">Замечания</button></div><div id="inspectorBody" class="inspector-body">${frame ? (state.inspectorTab === 'image' ? inspectorImageTab(frame) : state.inspectorTab === 'reviews' ? inspectorReviewsTab(frame) : inspectorFrameTab(frame)) : ''}</div></aside>
  </div></section>`;
  await hydrateImages(view);
  wireReader(frame);
}

function wireReader(frame) {
  view.querySelectorAll('[data-scene-id]').forEach(button => button.onclick = () => {
    const scene = sceneById(button.dataset.sceneId);
    const first = sceneFrames(scene)[0];
    if (first) selectFragment(first.fragmentId, { direct: true });
  });
  $('sceneSearch').oninput = event => {
    const query = event.target.value.toLowerCase();
    view.querySelectorAll('[data-scene-id]').forEach(button => button.classList.toggle('hidden', !button.textContent.toLowerCase().includes(query)));
  };
  $('toggleScenes').onclick = () => view.querySelector('.reader-sidebar').classList.toggle('open');
  $('toggleInspector').onclick = () => view.querySelector('.reader-inspector').classList.toggle('open');
  $('openPreviewTop').onclick = () => setRoute('preview');
  view.querySelectorAll('[data-inspector-tab]').forEach(button => button.onclick = () => { state.inspectorTab = button.dataset.inspectorTab; renderReader(); });
  $('commentCurrent')?.addEventListener('click', () => openReviewForm({ targetType: 'text' }));
  $('editCurrent')?.addEventListener('click', () => { state.inspectorTab = 'frame'; renderReader(); setTimeout(() => $('frameTextEditor')?.focus(), 40); });
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
    renderReader();
  });
  $('backFrame').onclick = async () => {
    if (state.directFragmentId) return moveDirect(-1);
    state.engine.back(); syncSelectedWithEngine(); await saveSession(); await persistWorkspaceSelection(); renderReader();
  };
  $('forwardFrame').onclick = async () => {
    if (state.directFragmentId) return moveDirect(1);
    const entry = state.engine.currentEntry();
    if (entry?.kind === 'choice' && !entry.selectedOptionId) return toast('Сначала выберите действие');
    await state.engine.forward(); syncSelectedWithEngine(); await saveSession(); await persistWorkspaceSelection(); renderReader();
  };
  $('firstFrame').onclick = () => selectFragment(currentFrames()[0]?.fragmentId, { direct: true });
  $('lastFrame').onclick = () => selectFragment(currentFrames().at(-1)?.fragmentId, { direct: true });
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
    renderReader();
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
    renderReader();
  } catch (error) { toast(error.message); }
}

async function removeCurrentVisual() {
  const before = currentAssignment();
  const after = { ...before, assetId: null, status: 'missing', updatedAt: Domain.now() };
  await applyAssignmentChange(state.selectedFragmentId, after, 'remove visual');
  toast('Связь с изображением удалена');
  renderReader();
}

async function saveVisualSettingsFromInspector() {
  const current = currentAssignment();
  const after = { ...current, zoom: Number($('visualZoom').value), overlayOpacity: Number($('visualOverlay').value), status: $('visualStatus').value, updatedAt: Domain.now() };
  if (!after.assetId && after.status !== 'missing') after.status = 'missing';
  await applyAssignmentChange(state.selectedFragmentId, after, 'visual settings');
  toast('Настройки визуала сохранены');
  renderReader();
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
  const frames = sceneFrames(scene).filter(frame => {
    const assignment = currentAssignment(frame.fragmentId);
    if (state.storyboardFilter === 'missing') return !assignment?.assetId;
    if (state.storyboardFilter === 'needs-review') return assignment?.status === 'needs-review';
    if (state.storyboardFilter === 'approved') return assignment?.status === 'approved';
    if (state.storyboardFilter === 'reviews') return currentReviews(frame.fragmentId).length > 0;
    return true;
  });
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">СТОРИБОРД</span><h1>${Domain.escapeHtml(scene.chapterTitle)} · ${Domain.escapeHtml(scene.title)}</h1><p>Визуальная последовательность кадр за кадром.</p></div><div class="header-actions"><button id="batchAssets" class="button secondary">Загрузить изображения</button><button id="approveSelectedFrames" class="button secondary">Утвердить выбранные</button><button id="nextMissing" class="button primary">Следующий без изображения</button></div></header>
    <div class="storyboard-toolbar"><select id="storyboardScene" class="select">${currentContent().scenes.map(item => `<option value="${Domain.escapeHtml(item.id)}" ${item.id === scene.id ? 'selected' : ''}>${Domain.escapeHtml(`${item.chapterTitle} · ${item.id} · ${item.title}`)}</option>`).join('')}</select><select id="storyboardFilter" class="select"><option value="all">Все кадры</option><option value="missing">Без изображения</option><option value="needs-review">Требуют проверки</option><option value="approved">Утверждённые</option><option value="reviews">С замечаниями</option></select><span class="status-badge">${frames.length} ${Domain.plural(frames.length, 'кадр', 'кадра', 'кадров')}</span></div>
    <div class="storyboard-grid">${frames.map((fragment, index) => {
      const ref = Domain.getFrameRef(currentContent(), fragment.fragmentId);
      const assignment = currentAssignment(fragment.fragmentId);
      const asset = assignment?.assetId ? state.assetMap.get(assignment.assetId) : null;
      const text = Domain.effectiveText(ref.step, state.workspace);
      return `<article class="card frame-card" data-frame-card="${Domain.escapeHtml(fragment.fragmentId)}"><div class="frame-thumb">${asset ? `<img data-asset-src="${Domain.escapeHtml(asset.assetId)}" data-thumbnail="true" alt="">` : '<div class="visual-placeholder"><strong>Нет изображения</strong></div>'}</div><div class="frame-card-copy"><h3><span><input type="checkbox" data-select-frame="${fragment.fragmentId}" ${state.storyboardSelection.has(fragment.fragmentId) ? 'checked' : ''} aria-label="Выбрать кадр"> ${Domain.escapeHtml(ref.step.speaker || Domain.textTypeLabel(ref.step.type))}</span><small>${index + 1}/${frames.length}</small></h3><div class="frame-card-text">${Domain.escapeHtml(text)}</div><div class="frame-card-meta"><span class="status-badge ${assignment?.status || 'missing'}">${Domain.statusLabel(assignment?.status || 'missing')}</span>${currentReviews(fragment.fragmentId).length ? `<span class="status-badge needs-review">${currentReviews(fragment.fragmentId).length} замеч.</span>` : ''}</div></div><div class="frame-card-actions"><button class="button secondary small" data-card-reader="${fragment.fragmentId}">Читать</button><button class="button secondary small" data-card-preview="${fragment.fragmentId}">Превью</button><button class="button primary small" data-card-image="${fragment.fragmentId}">${asset ? 'Заменить' : 'Изображение'}</button></div></article>`;
    }).join('')}</div>${frames.length ? '' : '<div class="empty-state"><div><h2>Кадры не найдены</h2><p>Измените фильтр.</p></div></div>'}</section>`;
  $('storyboardFilter').value = state.storyboardFilter;
  $('storyboardFilter').onchange = () => { state.storyboardFilter = $('storyboardFilter').value; renderStoryboard(); };
  $('storyboardScene').onchange = () => { state.selectedSceneId = $('storyboardScene').value; renderStoryboard(); };
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
  const assets = state.assets.filter(asset => !query || `${asset.name} ${asset.assetId}`.toLowerCase().includes(query));
  const usageMap = new Map();
  for (const assignment of state.assignments) if (assignment.assetId) usageMap.set(assignment.assetId, (usageMap.get(assignment.assetId) || 0) + 1);
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">ASSET LIBRARY</span><h1>Изображения проекта</h1><p>Оригиналы хранятся как Blob в IndexedDB; кадры используют независимые VisualAssignment.</p></div><div class="header-actions"><button id="uploadAssets" class="button primary">Загрузить изображения</button></div></header><div class="filters"><input id="assetSearch" class="input" style="max-width:420px" placeholder="Название или Asset ID" value="${Domain.escapeHtml(state.assetSearch)}"><span class="status-badge">${assets.length} файлов</span></div><div class="asset-grid">${assets.map(asset => `<article class="card asset-card"><div class="asset-thumb"><img data-asset-src="${Domain.escapeHtml(asset.assetId)}" data-thumbnail="true" alt=""></div><div class="asset-copy"><strong title="${Domain.escapeHtml(asset.name)}">${Domain.escapeHtml(asset.name)}</strong><small>${asset.width}×${asset.height} · ${Math.round(asset.fileSize / 1024)} КБ · используется: ${usageMap.get(asset.assetId) || 0}</small></div><div class="asset-actions"><button class="button primary small" data-assign-asset="${asset.assetId}">Назначить кадру</button><button class="button secondary small" data-delete-asset="${asset.assetId}">Удалить</button></div></article>`).join('')}</div>${assets.length ? '' : '<div class="empty-state"><div><h2>Изображений нет</h2><p>Загрузите PNG, JPEG, WebP или AVIF.</p></div></div>'}</section>`;
  $('uploadAssets').onclick = () => { $('assetInput').dataset.mode = 'library'; $('assetInput').value = ''; $('assetInput').click(); };
  $('assetSearch').oninput = event => { state.assetSearch = event.target.value; renderAssets(); };
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
  const reviews = state.reviews.filter(review => {
    if (state.reviewFilter === 'open') return !Domain.CLOSED_REVIEW_STATUSES.has(review.status);
    if (state.reviewFilter === 'text') return review.targetType === 'text';
    if (state.reviewFilter === 'image') return review.targetType === 'image';
    if (state.reviewFilter === 'critical') return review.severity === 'critical' && !Domain.CLOSED_REVIEW_STATUSES.has(review.status);
    return true;
  }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">REVIEW QUEUE</span><h1>Замечания</h1><p>Текстовая, визуальная и композиционная вычитка.</p></div><button id="gptFromReviews" class="button primary">Подготовить для GPT</button></header><div class="filters"><select id="reviewFilter" class="select" style="max-width:240px"><option value="open">Открытые</option><option value="all">Все</option><option value="text">Текст</option><option value="image">Изображения</option><option value="critical">Критичные</option></select><span class="status-badge">${reviews.length}</span></div><div class="review-list">${reviews.map(review => `<article class="card pad"><div class="review-card-head"><div><span class="kicker">${Domain.escapeHtml(review.targetType)}</span><strong>${Domain.escapeHtml(review.category)}</strong></div><span class="status-badge ${review.severity === 'critical' ? 'missing' : 'draft'}">${Domain.escapeHtml(review.status)}</span></div><p>${Domain.escapeHtml(review.comment)}</p>${review.quotedText ? `<blockquote>${Domain.escapeHtml(review.quotedText)}</blockquote>` : ''}<div class="inline-actions"><select class="select" style="max-width:210px" data-review-status="${review.reviewId}">${Domain.REVIEW_STATUSES.map(status => `<option ${status === review.status ? 'selected' : ''}>${status}</option>`).join('')}</select><button class="button secondary small" data-review-jump="${review.fragmentId}">Открыть кадр</button></div></article>`).join('')}</div>${reviews.length ? '' : '<div class="empty-state"><div><h2>Замечаний нет</h2><p>Открытые задачи появятся здесь.</p></div></div>'}</section>`;
  $('reviewFilter').value = state.reviewFilter;
  $('reviewFilter').onchange = () => { state.reviewFilter = $('reviewFilter').value; renderReviews(); };
  $('gptFromReviews').onclick = exportGptRequest;
  view.querySelectorAll('[data-review-status]').forEach(select => select.onchange = () => updateReviewStatus(select.dataset.reviewStatus, select.value));
  view.querySelectorAll('[data-review-jump]').forEach(button => button.onclick = () => selectFragment(button.dataset.reviewJump, { route: 'reader', direct: true }));
}

async function renderVersions() {
  if (!state.project) return renderNoProject('Версии');
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">VERSION CONTROL</span><h1>Версии сценария</h1><p>Текст и визуальный manifest сохраняются как единый snapshot.</p></div><button id="createVersion" class="button primary">Создать версию</button></header><div class="version-list">${state.versions.map(version => `<article class="card version-card"><div class="version-card-head"><div><span class="kicker">${version.versionId === state.version.versionId ? 'ТЕКУЩАЯ' : 'ВЕРСИЯ'}</span><h3>${Domain.escapeHtml(version.label)}</h3><p class="muted">${Domain.formatDate(version.createdAt)}${version.parentVersionId ? ` · parent: ${Domain.escapeHtml(version.parentVersionId)}` : ''}</p></div><div class="inline-actions"><button class="button secondary small" data-open-version="${version.versionId}" ${version.versionId === state.version.versionId ? 'disabled' : ''}>Открыть</button><button class="button secondary small" data-diff-version="${version.versionId}">Diff</button></div></div></article>`).join('')}</div></section>`;
  $('createVersion').onclick = createVersion;
  view.querySelectorAll('[data-open-version]').forEach(button => button.onclick = () => switchVersion(button.dataset.openVersion));
  view.querySelectorAll('[data-diff-version]').forEach(button => button.onclick = () => showVersionDiff(button.dataset.diffVersion));
}

async function createVersion() {
  const label = prompt('Название новой версии', `Редакция ${new Date().toLocaleDateString('ru-RU')}`);
  if (!label) return;
  const content = Domain.applyTextEditsToContent(currentContent(), state.workspace.textEdits || {});
  const versionId = `${state.project.projectId}::${Domain.slug(label)}-${Date.now().toString(36)}`;
  const validation = parser.validateNovel(content);
  const version = { versionId, projectId: state.project.projectId, label, parentVersionId: state.version.versionId, sourceType: 'editor-v3', createdAt: Domain.now(), updatedAt: Domain.now(), content, validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, stats: validation.stats } };
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
  const version = await DB.get('versions', versionId);
  if (!version) return;
  const parent = version.parentVersionId ? await DB.get('versions', version.parentVersionId) : null;
  if (!parent) return toast('Для первой версии нет parent Diff');
  const beforeMap = new Map(Domain.flattenFrames(parent.content).map(frame => [frame.fragmentId, frame]));
  const changes = [];
  for (const frame of Domain.flattenFrames(version.content)) {
    const before = beforeMap.get(frame.fragmentId);
    if (before && before.text !== frame.text) changes.push({ fragmentId: frame.fragmentId, before: before.text, after: frame.text });
  }
  const [beforeVisuals, afterVisuals] = await Promise.all([
    DB.getAllByIndex('visualAssignments', 'scopeId', DB.versionScope(parent.versionId)),
    DB.getAllByIndex('visualAssignments', 'scopeId', DB.versionScope(version.versionId))
  ]);
  const beforeVisualMap = new Map(beforeVisuals.map(item => [item.fragmentId, item]));
  const visualChanges = afterVisuals.filter(item => {
    const before = beforeVisualMap.get(item.fragmentId);
    return before && (before.assetId !== item.assetId || JSON.stringify(before.focalPoint) !== JSON.stringify(item.focalPoint) || before.zoom !== item.zoom);
  });
  openModal({ kicker: 'VERSION DIFF', title: `${parent.label} → ${version.label}`, body: `<p class="muted">Текстовых изменений: ${changes.length} · визуальных: ${visualChanges.length}</p>${changes.slice(0, 50).map(change => `<div class="diff-grid"><div class="diff-pane before"><span>Было · ${change.fragmentId}</span>${Domain.escapeHtml(change.before)}</div><div class="diff-pane after"><span>Стало</span>${Domain.escapeHtml(change.after)}</div></div>`).join('') || '<div class="empty-state"><p>Текстовых изменений нет.</p></div>'}${visualChanges.length ? `<h3>Визуальные изменения</h3>${visualChanges.slice(0, 50).map(item => `<p><strong>${item.fragmentId}</strong>: ${beforeVisualMap.get(item.fragmentId)?.assetId || 'нет'} → ${item.assetId || 'нет'}</p>`).join('')}` : ''}`, footer: '<button id="closeDiff" class="button primary">Готово</button>' });
  $('closeDiff').onclick = closeModal;
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
  const candidate = await DB.get('gptCandidates', candidateId);
  if (!candidate) return;
  openModal({ kicker: 'GPT DIFF', title: 'Проверка исправлений', body: `<div id="candidateChanges">${(candidate.changes || []).map((change, index) => `<article class="card pad" style="margin-bottom:12px"><div class="diff-grid"><div class="diff-pane before"><span>Было · ${Domain.escapeHtml(change.fragmentId)}</span>${Domain.escapeHtml(change.originalText || '')}</div><div class="diff-pane after"><span>Предложение</span>${Domain.escapeHtml(change.revisedText || '')}</div></div><p class="muted">${Domain.escapeHtml(change.reason || '')}</p><div class="inline-actions"><button class="button primary small" data-accept-change="${index}">Принять</button><button class="button secondary small" data-reject-change="${index}">Отклонить</button></div></article>`).join('')}</div>`, footer: '<button id="candidateDone" class="button primary">Готово</button>' });
  $('candidateDone').onclick = closeModal;
  $('candidateChanges').querySelectorAll('[data-accept-change]').forEach(button => button.onclick = async () => {
    const change = candidate.changes[Number(button.dataset.acceptChange)];
    await changeText(change.fragmentId, change.revisedText);
    change.decision = 'accepted';
    for (const reviewId of change.reviewIds || []) await updateReviewStatus(reviewId, 'Требует проверки');
    await DB.put('gptCandidates', { ...candidate, updatedAt: Domain.now() });
    button.closest('article').style.opacity = '.55';
    toast('Исправление принято в workspace');
  });
  $('candidateChanges').querySelectorAll('[data-reject-change]').forEach(button => button.onclick = async () => {
    const change = candidate.changes[Number(button.dataset.rejectChange)];
    change.decision = 'rejected';
    await DB.put('gptCandidates', { ...candidate, updatedAt: Domain.now() });
    button.closest('article').style.opacity = '.55';
  });
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
      : 'Основной рабочий режим: полный outline слева, ключевые решения в центре и инспектор справа.';
  view.className = 'view';
  view.innerHTML = `<section class="page full"><div class="graph-page graph-view-${state.graphView}">
    <div class="graph-modebar">
      <div class="graph-view-tabs" role="tablist" aria-label="Представление карты">
        <button class="graph-view-tab ${state.graphView === 'structure' ? 'active' : ''}" data-graph-view="structure" type="button"><strong>Структура</strong><span>Outline + minimap</span></button>
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
    state.graphNavigation = enableGraphNavigation($('graphViewport'), svg, { initial: state.graphView === 'metro' ? .9 : .8, onZoom: zoom => { if ($('graphZoomLabel')) $('graphZoomLabel').textContent = `${Math.round(zoom * 100)}%`; } });
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
      <section class="graph-inspector-section"><h3>Маршрут</h3><span class="graph-route-badge route-${node.routeKey || 'common'}">${node.routeKey === 'equal' ? 'На равных' : node.routeKey === 'fire' ? 'Игра с огнём' : node.routeKey === 'mask' ? 'Без масок' : node.routeKey === 'direct' ? 'Прямой маршрут' : 'Общая линия'}</span><div class="graph-link-stats"><span><b>${incoming.length}</b> входов</span><span><b>${outgoing.length}</b> выходов</span></div></section>
      <div class="grid"><button id="graphReader" class="button primary">Открыть в Reader</button><button id="graphStoryboard" class="button secondary">Открыть Storyboard</button><button id="graphPreview" class="button secondary">Открыть Preview</button></div>`;
  }
  host.querySelectorAll('[data-inspector-node]').forEach(button => button.onclick = () => { const target = model?.nodes?.find(item => item.id === button.dataset.inspectorNode); if (target) { showGraphInspector(target, model); state.graphNavigation?.focusNode?.(target.id); } });
  $('graphReader').onclick = () => { const first = sceneFrames(sceneById(node.sceneId))[0]; if (first) selectFragment(first.fragmentId, { route: 'reader', direct: true }); };
  $('graphStoryboard')?.addEventListener('click', () => { state.selectedSceneId = node.sceneId; setRoute('storyboard'); });
  $('graphPreview')?.addEventListener('click', () => { const first = sceneFrames(sceneById(node.sceneId))[0]; if (first) selectFragment(first.fragmentId, { route: 'preview', direct: true }); });
}

async function renderExport() {
  if (!state.project) return renderNoProject('Экспорт');
  const metrics = Domain.projectMetrics(currentContent(), state.workspace, state.assignments, state.reviews);
  const estimate = state.storage || await DB.storageEstimate();
  view.className = 'view';
  view.innerHTML = `<section class="page"><header class="page-header"><div><span class="kicker">IMPORT / EXPORT</span><h1>Пакеты проекта</h1><p>Master DOCX, полный Project ZIP и оптимизированный runtime build.</p></div></header><div class="metric-grid">${metricsHtml(metrics)}</div><div class="export-grid"><article class="card export-card"><h2>Project ZIP</h2><p>Полный проект: сценарий, версии, визуальный manifest, изображения, замечания и прогресс.</p><button id="exportProject" class="button primary">Скачать Project ZIP</button><button id="importProject" class="button secondary">Импортировать Project ZIP</button></article><article class="card export-card"><h2>Runtime build</h2><p>Только утверждённые тексты, изображения и интерактивная структура. Производственная сборка блокируется при missing visual.</p><button id="exportRuntime" class="button primary" ${metrics.missing ? 'disabled' : ''}>Собрать runtime</button>${metrics.missing ? `<span class="status-badge missing">Не назначено: ${metrics.missing}</span>` : '<span class="status-badge approved">Готово</span>'}<button id="exportDraftRuntime" class="button secondary">Черновой runtime с placeholders</button></article><article class="card export-card"><h2>Master DOCX</h2><p>Актуальный текст сценария с устойчивыми Fragment ID.</p><button id="exportDocx" class="button primary">Скачать DOCX</button><button id="exportJson" class="button secondary">Скачать HEARTLINE JSON</button></article><article class="card export-card"><h2>Отчёты</h2><p>CSV замечаний и проверка качества визуалов.</p><button id="exportReviews" class="button secondary">Замечания CSV</button><button id="exportQuality" class="button secondary">Quality report JSON</button></article><article class="card export-card"><h2>Локальное хранилище</h2><p>Использовано: ${estimate?.usage ? `${Math.round(estimate.usage / 1024 / 1024)} МБ` : 'н/д'} из ${estimate?.quota ? `${Math.round(estimate.quota / 1024 / 1024)} МБ` : 'н/д'}.</p><button id="persistStorage" class="button secondary">Запросить persistent storage</button></article></div></section>`;
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
    { name: 'README.txt', data: 'HEARTLINE Editor v3 Project ZIP. Импортируйте через Экспорт → Project ZIP.' }
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
  const [engineSource, domainSource, playerSource] = await Promise.all([fetch('./app-v300/engine.js').then(r => r.text()), fetch('./app-v300/domain.js').then(r => r.text()), fetch('./app-v300/player-renderer.js').then(r => r.text())]);
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
function runtimePlayerJs() { return `import {StoryEngine,createSession} from './heartline-v301-engine.js';\nimport {renderPlayerFrame} from './heartline-v301-player-renderer.js';\nconst data=await fetch('./runtime.json').then(r=>r.json());const host=document.getElementById('player');const session=createSession('runtime',data.versionId,data.novel);const engine=new StoryEngine(data.novel,session);engine.advance();function ref(id){for(const s of data.novel.scenes){const stack=[...(s.steps||[])];while(stack.length){const x=stack.shift();if(x.fragmentId===id)return{x,s};if(x.type==='choice')for(const o of x.options||[])stack.push(...(o.steps||[]));}}}function draw(){const e=engine.currentEntry();if(!e)return;const r=ref(e.fragmentId);if(!r)return;const st=r.x,m=data.visualManifest[e.fragmentId]||{},path=m.assetId?data.visualManifest.__assets?.[m.assetId]:null;const frame={fragmentId:e.fragmentId,sceneId:r.s.id,sceneTitle:r.s.title,type:st.type,speaker:st.speaker||'',text:st.type==='choice'?(st.prompt||''):(st.text||''),options:st.type==='choice'?(st.options||[]).map(o=>({id:o.id,label:o.label})):[],visualPrompt:r.s.title,assignment:m,asset:null};const device={id:'runtime',label:'Runtime',width:window.innerWidth,height:window.innerHeight,safeTop:Math.max(20,Number(getComputedStyle(document.documentElement).getPropertyValue('--sat')||0)),safeBottom:24,fontSize:Math.max(16,Math.min(20,window.innerWidth/22))};renderPlayerFrame(host,{frame,device,orientation:window.innerWidth>window.innerHeight?'landscape':'portrait',assetUrl:path,scaleToFit:false,bare:true,showStatusBar:false,onChoose:id=>{engine.choose(id);draw()}});if(st.type!=='choice'){const next=document.createElement('button');next.className='runtime-next';next.setAttribute('aria-label','Далее');next.onclick=()=>{engine.forward();draw()};host.querySelector('.player-screen').append(next)}}window.addEventListener('resize',draw);draw();`; }

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
  document.querySelectorAll('[data-route]').forEach(button => button.onclick = () => setRoute(button.dataset.route));
  $('brandButton').onclick = () => setRoute('library');
  $('modalClose').onclick = closeModal;
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  $('undoButton').onclick = undo;
  $('redoButton').onclick = redo;
  $('novelInput').onchange = () => $('novelInput').files.length && handleNovelImport($('novelInput').files);
  $('frameAssetInput').onchange = () => handleFrameAsset($('frameAssetInput').files[0]);
  $('assetInput').onchange = () => $('assetInput').files.length && handleAssetInput($('assetInput').files, $('assetInput').dataset.mode || 'library');
  $('gptInput').onchange = () => $('gptInput').files[0] && handleGptImport($('gptInput').files[0]);
  $('projectImportInput').onchange = () => $('projectImportInput').files[0] && importProjectZip($('projectImportInput').files[0]);
  window.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select') || modal.open) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (state.route === 'reader') {
      if (event.key === 'ArrowLeft') $('backFrame')?.click();
      if (event.key === 'ArrowRight') $('forwardFrame')?.click();
      if (event.key.toLowerCase() === 'c') openReviewForm({ targetType: 'text' });
      if (event.key.toLowerCase() === 'e') { state.inspectorTab = 'frame'; renderReader(); }
      if (event.key.toLowerCase() === 'i') { state.inspectorTab = 'image'; renderReader(); }
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
  render();
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
    await ensureBuiltinProject();
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
