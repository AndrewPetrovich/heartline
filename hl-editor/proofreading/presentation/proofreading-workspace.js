import { getAppServices } from '../../application/service-container.js';
import { TEXT_REVIEW_CATEGORIES, workflowStatusFromLegacy } from '../domain/proofreading.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const READER_PREFS_KEY = 'heartline-reader-prefs-v1';
let service = null;
let active = false;
let redirectingLegacyReader = false;
let model = null;
let selectedFragmentId = null;
let rightTab = 'reviews';
let editorSaveTimer = null;
let editorSaving = false;
let lastEditorSavedValue = null;
let currentFindings = [];
let searchPreview = null;
let styleReport = null;
let toastTimer = null;

function loadReaderPrefs() {
  const defaults = { context: 'auto', textScale: 1, lineHeight: 1.58, font: 'serif', columnWidth: 790, focus: false };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(READER_PREFS_KEY) || '{}') }; }
  catch (_) { return defaults; }
}
let readerPrefs = loadReaderPrefs();
function persistReaderPrefs() { localStorage.setItem(READER_PREFS_KEY, JSON.stringify(readerPrefs)); }

function getService() {
  service ||= getAppServices().proofreadingService;
  return service;
}

function installStyles() {
  if (document.getElementById('hlProofreadingStyles')) return;
  const link = document.createElement('link');
  link.id = 'hlProofreadingStyles';
  link.rel = 'stylesheet';
  link.href = new URL('./proofreading.css', import.meta.url).href;
  document.head.appendChild(link);
}

function statusLabel(status) {
  return ({
    'not-started': 'Не вычитано', 'in-progress': 'В работе', attention: 'Есть замечания',
    reviewed: 'Вычитано', approved: 'Утверждено', changed: 'Изменено после вычитки'
  })[status] || status;
}

function workflowLabel(status) {
  return ({ open: 'Открыто', 'fix-proposed': 'Предложено исправление', verify: 'Проверить исправление', resolved: 'Решено', 'wont-fix': 'Не исправлять' })[status] || status;
}

function categoryForFinding(code) {
  if (/space|punctuation|dash|quote/.test(code)) return 'Пунктуация';
  if (/word/.test(code)) return 'Повтор';
  if (/terminology/.test(code)) return 'Терминология';
  if (/mixed-scripts/.test(code)) return 'Орфография';
  return 'Другое';
}

function proofToast(message, kind = 'info') {
  let node = $('hlProofToast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'hlProofToast';
    node.className = 'hl-proof-toast';
    document.body.appendChild(node);
  }
  clearTimeout(toastTimer);
  node.dataset.kind = kind;
  node.textContent = message;
  node.classList.add('visible');
  toastTimer = setTimeout(() => node.classList.remove('visible'), 3200);
}

function currentUnit() { return model?.units?.find(unit => unit.fragmentId === selectedFragmentId) || null; }
function currentScene() { const unit = currentUnit(); return unit ? model.scenes.find(scene => scene.sceneId === unit.sceneId) : null; }
function currentChapter() { const unit = currentUnit(); return unit ? model.chapters.find(chapter => chapter.chapterId === unit.chapterId) : null; }

async function reloadModel({ keepSelection = true, render = true } = {}) {
  if (!model?.project?.projectId) return;
  const previous = keepSelection ? selectedFragmentId : null;
  model = await getService().load(model.project.projectId);
  if (previous && model.units.some(unit => unit.fragmentId === previous)) selectedFragmentId = previous;
  else selectedFragmentId = model.workspace.selectedFragmentId || getService().nextPending(model, null, 1)?.fragmentId || model.units[0]?.fragmentId || null;
  if (render) renderWorkspace();
}

async function openProofreading() {
  if (active && document.querySelector('.hl-proofreading-shell')) return;
  active = true;
  document.body.classList.add('hl-proofreading-active');
  document.body.classList.remove('reader-active');
  document.querySelectorAll('[data-route]').forEach(button => button.classList.remove('active'));
  document.querySelectorAll('.hl-proof-nav').forEach(button => button.classList.add('active'));
  const projectId = await getService().getActiveProjectId();
  const view = $('view');
  if (!projectId) {
    view.className = 'view';
    view.innerHTML = '<section class="hl-proof-top-error"><h1>Вычитка</h1><p>Сначала откройте или подключите проект.</p></section>';
    return;
  }
  try {
    model = await getService().load(projectId);
    await getService().upgradeLegacyAnchors(projectId).catch(() => 0);
    model = await getService().load(projectId);
    selectedFragmentId = model.workspace.selectedFragmentId || getService().nextPending(model, null, 1)?.fragmentId || model.units[0]?.fragmentId || null;
    renderWorkspace();
  } catch (error) {
    view.className = 'view';
    view.innerHTML = `<section class="hl-proof-top-error"><h1>Вычитка недоступна</h1><p>${esc(error.message || error)}</p></section>`;
  }
}

function leaveProofreading() {
  if (!active) return;
  active = false;
  clearTimeout(editorSaveTimer);
  document.body.classList.remove('hl-proofreading-active');
  document.querySelectorAll('.hl-proof-nav').forEach(button => button.classList.remove('active'));
}

function makeProofNav(id) {
  const button = document.createElement('button');
  button.id = id;
  button.className = 'nav-button hl-proof-nav';
  button.type = 'button';
  button.textContent = 'Вычитка';
  button.onclick = openProofreading;
  return button;
}

function installNavigation() {
  const desktop = $('mainNav');
  const desktopReader = desktop?.querySelector('[data-route="reader"]');
  if (desktopReader) { desktopReader.hidden = true; desktopReader.style.display = 'none'; }
  if (desktop && !$('hlProofreadingNav')) {
    const button = makeProofNav('hlProofreadingNav');
    desktop.insertBefore(button, desktopReader || desktop.children[1] || null);
  }

  const mobile = document.querySelector('.mobile-nav');
  const mobileReader = mobile?.querySelector('[data-route="reader"]');
  if (mobileReader) { mobileReader.hidden = true; mobileReader.style.display = 'none'; }
  const storyboard = mobile?.querySelector('[data-route="storyboard"]');
  if (storyboard) storyboard.style.display = '';
  if (mobile && !$('hlProofreadingMobileNav')) {
    const button = makeProofNav('hlProofreadingMobileNav');
    mobile.insertBefore(button, mobileReader || mobile.children[1] || null);
  }

  document.querySelectorAll('[data-route],#brandButton').forEach(button => {
    if (button.dataset.hlProofLeaveBound) return;
    button.dataset.hlProofLeaveBound = '1';
    button.addEventListener('click', () => {
      if (!button.classList.contains('hl-proof-nav')) leaveProofreading();
    }, true);
  });
}

function redirectLegacyReaderIfNeeded() {
  if (active || redirectingLegacyReader || !document.getElementById('readerShell')) return;
  redirectingLegacyReader = true;
  setTimeout(async () => {
    try { await openProofreading(); }
    finally { redirectingLegacyReader = false; }
  }, 0);
}

function progressHtml(progress) {
  return `<div class="hl-proof-progress"><div class="hl-proof-progress-bar"><i style="width:${progress.percent}%"></i></div><small>${progress.percent}% вычитано</small></div>`;
}

function outlineHtml() {
  const route = model.routeCoverage?.total
    ? `<div class="hl-proof-route-coverage"><h3>Покрытие веток · ${model.routeCoverage.completed}/${model.routeCoverage.total}</h3>${model.routeCoverage.routes.map(item => `<div class="hl-proof-route"><span>${esc(item.title)}</span><b>${item.percent}%</b></div>`).join('')}</div>`
    : '';
  return `<div class="hl-proof-book-summary">
    <div class="hl-proof-metric"><strong>${model.progress.percent}%</strong><span>вычитано</span></div>
    <div class="hl-proof-metric"><strong>${model.progress.counts.attention}</strong><span>с замечаниями</span></div>
    <div class="hl-proof-metric"><strong>${model.progress.counts.changed}</strong><span>изменено</span></div>
  </div>${model.chapters.map(chapter => `<details class="hl-proof-chapter" ${chapter.units.some(unit => unit.fragmentId === selectedFragmentId) ? 'open' : ''}>
    <summary><span class="hl-proof-dot"></span><strong>${esc(chapter.title)}</strong><small>${chapter.progress.percent}%</small></summary>
    ${chapter.scenes.map(scene => `<div class="hl-proof-scene ${scene.units.some(unit => unit.fragmentId === selectedFragmentId) ? 'open' : ''}" data-scene="${esc(scene.sceneId)}">
      <div class="hl-proof-scene-head"><strong>${esc(scene.title)}</strong><small>${scene.progress.percent}% · ${statusLabel(scene.progress.status)}</small></div>
      <div class="hl-proof-units">${scene.units.map(unit => `<button class="hl-proof-unit ${unit.fragmentId === selectedFragmentId ? 'active' : ''}" data-proof-unit="${esc(unit.fragmentId)}" data-status="${esc(unit.status)}"><i class="hl-proof-dot"></i><span class="excerpt">${esc(`${unit.speaker ? `${unit.speaker}: ` : ''}${unit.text}`)}</span><small>${unit.openReviewCount || ''}</small></button>`).join('')}</div>
    </div>`).join('')}</details>`).join('')}${route}`;
}

function contextLimit() {
  if (readerPrefs.context === 'auto') return window.matchMedia?.('(max-width:720px)').matches ? 1 : 2;
  return Math.max(0, Number(readerPrefs.context) || 0);
}

function contextUnits(unit, direction) {
  if (!unit) return [];
  const index = model.units.findIndex(item => item.fragmentId === unit.fragmentId);
  const result = [];
  const limit = direction < 0 ? contextLimit() : Math.min(1, contextLimit());
  for (let step = 1; step <= limit; step++) {
    const candidate = model.units[index + direction * step];
    if (!candidate || candidate.sceneId !== unit.sceneId) break;
    if (direction < 0) result.unshift(candidate); else result.push(candidate);
  }
  return result;
}

function contextHtml(unit, direction) {
  return contextUnits(unit, direction).map(candidate => `<div class="hl-proof-context${direction > 0 ? ' next' : ''}">${candidate.speaker ? `<strong>${esc(candidate.speaker)}</strong> ` : ''}${esc(candidate.text)}</div>`).join('');
}

function choiceOptionsHtml(unit) {
  if (!unit?.options?.length) return '';
  return `<div class="hl-proof-choice-options"><span>Варианты выбора</span>${unit.options.map(option => `<div>${esc(option.label)}</div>`).join('')}</div>`;
}

function editorHtml() {
  const unit = currentUnit();
  if (!unit) return '<div class="hl-proof-empty">Нет текстовых фрагментов.</div>';
  return `<article class="hl-proof-editor-card">
    ${contextHtml(unit, -1)}
    <header class="hl-proof-editor-head"><div><span class="kicker">ВЫЧИТКА</span><h2>${esc(`${unit.chapterTitle} · ${unit.sceneTitle}`)}</h2><p>${esc(`${unit.type}${unit.speaker ? ` · ${unit.speaker}` : ''} · ${unit.fragmentId}`)}</p></div><span id="hlProofStatus" class="hl-proof-status-pill" data-status="${esc(unit.status)}">${esc(statusLabel(unit.status))}</span></header>
    <div class="hl-proof-editor-wrap"><textarea id="hlProofEditor" class="hl-proof-editor" spellcheck="true">${esc(unit.text)}</textarea><div class="hl-proof-highlight-note">Выделите текст и нажмите «Замечание». Кнопка «Вперёд» автоматически отмечает текущий фрагмент вычитанным, если у него нет открытых замечаний.</div>${choiceOptionsHtml(unit)}</div>
    <div class="hl-proof-editor-actions"><button id="hlProofReview" class="button secondary small">Замечание</button><span id="hlProofSaveState" class="hl-proof-save-state">${esc(model.workspace.saveState || 'saved')}</span></div>
    ${contextHtml(unit, 1)}
  </article>`;
}

function reviewsHtml() {
  const unit = currentUnit();
  if (!unit) return '';
  const reviews = unit.reviews || [];
  return `<div class="hl-proof-section-title"><h3>Текстовые замечания</h3><button id="hlProofAddReview" class="hl-proof-small-button primary">+ замечание</button></div>
    <div id="hlProofReviewForm" class="hl-proof-form" hidden>
      <label>Категория<select id="hlProofReviewCategory">${TEXT_REVIEW_CATEGORIES.map(item => `<option>${esc(item)}</option>`).join('')}</select></label>
      <label>Важность<select id="hlProofReviewSeverity"><option value="normal">Обычное</option><option value="critical">Критичное</option></select></label>
      <label>Комментарий<textarea id="hlProofReviewComment" placeholder="Что исправить и почему?"></textarea></label>
      <div class="hl-proof-inline"><button id="hlProofReviewCancel" class="hl-proof-small-button">Отмена</button><button id="hlProofReviewSave" class="hl-proof-small-button primary">Сохранить</button></div>
    </div>
    ${reviews.length ? reviews.map(review => `<article class="hl-proof-review-card" data-review-id="${esc(review.reviewId)}"><header><strong>${esc(review.category || 'Другое')}</strong><select class="select" data-proof-review-status="${esc(review.reviewId)}">${model.reviewWorkflowStates.map(status => `<option value="${status}" ${status === review.workflowStatus ? 'selected' : ''}>${esc(workflowLabel(status))}</option>`).join('')}</select></header>${review.quotedText ? `<blockquote class="hl-proof-quote" data-proof-anchor="${esc(review.reviewId)}">${esc(review.quotedText)}</blockquote>` : ''}${review.resolvedAnchor && ['stale','ambiguous'].includes(review.resolvedAnchor.status) ? `<div class="hl-proof-anchor-stale">Привязка к тексту устарела: ${esc(review.resolvedAnchor.status)}</div>` : ''}<p>${esc(review.comment)}</p>${review.automation?.source ? `<small>Источник предложения: ${esc(review.automation.source)}</small>` : ''}</article>`).join('') : '<div class="hl-proof-empty">Замечаний для этого фрагмента нет.</div>'}`;
}

function findingsListHtml() {
  return currentFindings.length ? currentFindings.map((finding, index) => `<article class="hl-proof-finding" data-severity="${esc(finding.severity)}"><header><strong>${esc(finding.message)}</strong><span class="hl-proof-finding-code">${esc(finding.code)}</span></header><p>Позиция ${finding.startOffset}–${finding.endOffset}</p><div class="hl-proof-inline">${finding.replacement != null ? `<button class="hl-proof-small-button primary" data-finding-fix="${index}">Исправить</button>` : ''}<button class="hl-proof-small-button" data-finding-review="${index}">В замечание</button><button class="hl-proof-small-button" data-finding-ignore="${index}">Игнорировать</button></div></article>`).join('') : '<div class="hl-proof-empty compact">Локальная проверка доступна в разделе «Стиль и качество» для текущего фрагмента.</div>';
}

function qualityReportHtml() {
  if (!styleReport) return '<div class="hl-proof-empty compact">Запустите анализ, чтобы увидеть стилевой профиль и редакционную готовность книги.</div>';
  return `<div class="hl-proof-quality-score"><strong>${styleReport.readinessScore}</strong><div><b>Редакционная готовность: ${esc(styleReport.readinessLabel)}</b><small>${esc(styleReport.disclaimer)}</small></div></div>
    <div class="hl-proof-quality-grid"><div><b>${styleReport.words.toLocaleString('ru-RU')}</b><span>слов</span></div><div><b>${styleReport.avgSentenceWords}</b><span>слов / предложение</span></div><div><b>${styleReport.dialoguePercent}%</b><span>диалог</span></div><div><b>${styleReport.uniqueWordPercent}%</b><span>лексич. разнообразие</span></div><div><b>${styleReport.findingRate}</b><span>сигналов / 1000 слов</span></div><div><b>${styleReport.reviewedPercent}%</b><span>вычитано</span></div></div>
    <div class="hl-proof-style-signals">${styleReport.signals.map(signal => `<p>• ${esc(signal)}</p>`).join('')}</div>
    <div class="hl-proof-frequency"><b>Частые содержательные слова</b><div>${styleReport.frequentWords.map(item => `<span>${esc(item.word)} · ${item.count}</span>`).join('') || '<span>Недостаточно текста</span>'}</div></div>`;
}

function qualityHtml() {
  return `<div class="hl-proof-section-title"><h3>Стиль и качество</h3><button id="hlProofAnalyzeStyle" class="hl-proof-small-button primary">Анализировать книгу</button></div>
    <p class="hl-proof-help">HEARTLINE показывает редакционные сигналы, ритм, повторяемость и готовность текста. Это не автоматическая оценка художественной ценности.</p>
    ${qualityReportHtml()}
    <div class="hl-proof-section-title"><h3>Редакторская установка стиля</h3></div><div class="hl-proof-form"><label>Как должен звучать текст<textarea id="hlProofStyleGuide" placeholder="Например: короткие энергичные фразы, сдержанная ирония, минимум канцеляризмов…">${esc(model.state.styleGuide?.notes || '')}</textarea></label><button id="hlProofSaveStyleGuide" class="hl-proof-small-button">Сохранить установку</button></div>
    <div class="hl-proof-section-title quality-findings"><h3>Текущий фрагмент</h3><button id="hlProofRefreshFindings" class="hl-proof-small-button">Проверить</button></div>${findingsListHtml()}`;
}

function dictionaryHtml() {
  const dictionary = model.state.dictionary;
  return `<div class="hl-proof-section-title"><h3>Словарь проекта</h3></div><div class="hl-proof-form"><label>Правильное написание<input id="hlProofTermCanonical" placeholder="Например: Лиарен"></label><label>Варианты/ошибки<textarea id="hlProofTermVariants" placeholder="Лиарэн, Лиарин"></textarea></label><label>Комментарий<input id="hlProofTermNote" placeholder="Имя персонажа"></label><button id="hlProofAddTerm" class="hl-proof-small-button primary">Добавить термин</button></div>
    <div style="margin-top:10px">${dictionary.terms.map(term => `<article class="hl-proof-term"><strong>${esc(term.canonical)}</strong><p>${esc(term.variants.join(', ') || 'без вариантов')}${term.note ? `<br>${esc(term.note)}` : ''}</p><button class="hl-proof-small-button" data-remove-term="${esc(term.id)}">Удалить</button></article>`).join('') || '<div class="hl-proof-empty compact">Терминов пока нет.</div>'}</div>
    <div class="hl-proof-form" style="margin-top:12px"><label>Нежелательные слова/формы<textarea id="hlProofForbidden">${esc(dictionary.forbiddenWords.join('\n'))}</textarea></label><button id="hlProofSaveForbidden" class="hl-proof-small-button">Сохранить список</button></div>`;
}

function rightBodyHtml() { return rightTab === 'quality' ? qualityHtml() : reviewsHtml(); }
function rightTitleLabel() { return rightTab === 'quality' ? 'Стиль и качество' : 'Замечания'; }

function readerNavHtml() {
  const index = model.units.findIndex(item => item.fragmentId === selectedFragmentId);
  const firstDisabled = index <= 0 ? 'disabled' : '';
  const lastDisabled = index < 0 || index >= model.units.length - 1 ? 'disabled' : '';
  return `<footer class="hl-proof-reader-nav"><button id="hlProofFirst" class="button secondary" ${firstDisabled}>Первая</button><button id="hlProofBack" class="button secondary" ${firstDisabled}>← Назад</button><button id="hlProofForward" class="button primary">Вперёд →</button><button id="hlProofLast" class="button secondary" ${lastDisabled}>Последняя</button><span>${index >= 0 ? index + 1 : 0} / ${model.units.length}</span></footer>`;
}

function renderWorkspace() {
  const view = $('view');
  const unit = currentUnit();
  view.className = 'view';
  view.innerHTML = `<section class="hl-proofreading-shell ${readerPrefs.focus ? 'hl-proof-focus' : ''}"><header class="hl-proof-toolbar"><div class="hl-proof-title"><strong>Вычитка · ${esc(model.project.title)}</strong><span>Чтение, редактура и оценка стиля в одном рабочем режиме</span></div>${progressHtml(model.progress)}<button id="hlProofPending" class="button secondary small">К непроверенному</button><button id="hlProofSearch" class="button secondary small">Поиск / замена</button><button id="hlProofQuality" class="button secondary small">Стиль и качество</button><button id="hlProofView" class="button secondary small">Вид</button><button id="hlProofRightToggle" class="button secondary small hl-proof-right-toggle">Панель</button></header><div class="hl-proof-grid"><aside class="hl-proof-pane hl-proof-outline">${outlineHtml()}</aside><main class="hl-proof-pane hl-proof-center">${editorHtml()}</main><aside id="hlProofRight" class="hl-proof-pane hl-proof-right"><div class="hl-proof-right-head"><strong id="hlProofRightTitle">${esc(rightTitleLabel())}</strong><button id="hlProofRightClose" class="hl-proof-small-button hl-proof-right-close" type="button" aria-label="Закрыть панель">×</button></div><div id="hlProofRightBody" class="hl-proof-right-body">${rightBodyHtml()}</div></aside></div>${readerNavHtml()}</section>`;
  applyReaderPreferences();
  wireWorkspace(unit);
}

function applyReaderPreferences() {
  const shell = document.querySelector('.hl-proofreading-shell');
  if (!shell) return;
  shell.style.setProperty('--hl-proof-text-scale', String(readerPrefs.textScale));
  shell.style.setProperty('--hl-proof-line-height', String(readerPrefs.lineHeight));
  shell.style.setProperty('--hl-proof-column-width', `${Number(readerPrefs.columnWidth) || 790}px`);
  shell.classList.toggle('hl-proof-font-sans', readerPrefs.font === 'sans');
  shell.classList.toggle('hl-proof-focus', Boolean(readerPrefs.focus));
}

async function saveEditorNow({ flushSource = false } = {}) {
  clearTimeout(editorSaveTimer);
  const editor = $('hlProofEditor');
  const unit = currentUnit();
  if (!editor || !unit || editorSaving) return;
  const value = editor.value;
  if (lastEditorSavedValue === null) lastEditorSavedValue = unit.text;
  if (value === lastEditorSavedValue) {
    if (flushSource && window.HEARTLINEProjectCore?.flushSourceSave && model.workspace.dirty) await window.HEARTLINEProjectCore.flushSourceSave(model.project.projectId, 'autosave');
    return;
  }
  editorSaving = true;
  const stateNode = $('hlProofSaveState');
  if (stateNode) stateNode.textContent = 'saving';
  try {
    await getService().saveText(model.project.projectId, unit.fragmentId, value);
    unit.text = value;
    lastEditorSavedValue = value;
    if (stateNode) stateNode.textContent = flushSource ? 'saving source…' : 'dirty → autosave';
    if (flushSource && window.HEARTLINEProjectCore?.flushSourceSave) {
      const result = await window.HEARTLINEProjectCore.flushSourceSave(model.project.projectId, 'autosave');
      if (stateNode) stateNode.textContent = result?.status || 'saved';
    }
  } catch (error) {
    if (stateNode) stateNode.textContent = `error: ${error.message || error}`;
  } finally { editorSaving = false; }
}

async function selectUnit(fragmentId, { skipSave = false } = {}) {
  if (!skipSave) await saveEditorNow();
  const unit = model.units.find(item => item.fragmentId === fragmentId);
  if (!unit) return;
  selectedFragmentId = fragmentId;
  currentFindings = [];
  lastEditorSavedValue = null;
  await repository.setWorkspaceSelection(model.project.projectId, { fragmentId, sceneId: unit.sceneId }).catch(() => {});
  await reloadModel({ keepSelection: true, render: true });
}

async function goSequential(direction) {
  await saveEditorNow();
  const index = model.units.findIndex(item => item.fragmentId === selectedFragmentId);
  const target = model.units[index + direction];
  if (target) await selectUnit(target.fragmentId, { skipSave: true });
}

async function goBoundary(last = false) {
  await saveEditorNow();
  const target = last ? model.units.at(-1) : model.units[0];
  if (target) await selectUnit(target.fragmentId, { skipSave: true });
}

async function goForwardAndReview() {
  const index = model.units.findIndex(item => item.fragmentId === selectedFragmentId);
  if (index < 0) return;
  const isLast = index === model.units.length - 1;
  await saveEditorNow({ flushSource: isLast });
  await reloadModel({ keepSelection: true, render: false });
  let reviewed = true;
  try { await getService().markUnit(model.project.projectId, selectedFragmentId); }
  catch (error) {
    reviewed = false;
    proofToast('Фрагмент оставлен с замечанием и не отмечен вычитанным.', 'attention');
  }
  await reloadModel({ keepSelection: true, render: false });
  if (!isLast) {
    const target = model.units[index + 1];
    if (target) await selectUnit(target.fragmentId, { skipSave: true });
  } else {
    renderWorkspace();
    if (reviewed) proofToast('Последний фрагмент вычитан. Книга пройдена до конца.', 'success');
  }
}

function wireWorkspace(unit) {
  lastEditorSavedValue = unit?.text ?? null;
  $('hlProofEditor')?.addEventListener('input', () => { clearTimeout(editorSaveTimer); $('hlProofSaveState').textContent = 'dirty'; editorSaveTimer = setTimeout(() => saveEditorNow(), 650); });
  $('hlProofEditor')?.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveEditorNow({ flushSource: true }); } });
  document.querySelectorAll('[data-proof-unit]').forEach(button => button.onclick = () => selectUnit(button.dataset.proofUnit));
  document.querySelectorAll('.hl-proof-scene-head').forEach(head => head.onclick = () => head.closest('.hl-proof-scene')?.classList.toggle('open'));
  $('hlProofFirst')?.addEventListener('click', () => goBoundary(false));
  $('hlProofBack')?.addEventListener('click', () => goSequential(-1));
  $('hlProofForward')?.addEventListener('click', goForwardAndReview);
  $('hlProofLast')?.addEventListener('click', () => goBoundary(true));
  $('hlProofPending')?.addEventListener('click', async () => { await saveEditorNow(); await reloadModel({ keepSelection: true, render: false }); const next = getService().nextPending(model, selectedFragmentId, 1); if (next) selectUnit(next.fragmentId, { skipSave: true }); else proofToast('Невычитанных фрагментов без завершённого статуса нет.', 'success'); });
  $('hlProofSearch')?.addEventListener('click', openSearchDialog);
  $('hlProofQuality')?.addEventListener('click', async () => { rightTab = 'quality'; renderRight(); $('hlProofRight')?.classList.add('open'); });
  $('hlProofView')?.addEventListener('click', openViewDialog);
  $('hlProofRightToggle')?.addEventListener('click', () => {
    rightTab = 'reviews';
    renderRight();
    $('hlProofRight')?.classList.toggle('open');
  });
  $('hlProofRightClose')?.addEventListener('click', () => $('hlProofRight')?.classList.remove('open'));
  wireRight();
}

function proofreadingHotkeys(event) {
  if (!active) return;
  if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); goForwardAndReview(); }
  else if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); goSequential(-1); }
}

function renderRight() {
  const body = $('hlProofRightBody');
  if (!body) return;
  const title = $('hlProofRightTitle');
  if (title) title.textContent = rightTitleLabel();
  body.innerHTML = rightBodyHtml();
  wireRight();
}

function selectedOffsets() {
  const editor = $('hlProofEditor');
  if (!editor) return { startOffset: null, endOffset: null };
  return { startOffset: editor.selectionStart, endOffset: editor.selectionEnd };
}

function openReviewForm(prefill = {}) {
  rightTab = 'reviews'; renderRight();
  const form = $('hlProofReviewForm'); if (!form) return;
  form.hidden = false;
  $('hlProofReviewCategory').value = prefill.category || 'Другое';
  $('hlProofReviewSeverity').value = prefill.severity || 'normal';
  $('hlProofReviewComment').value = prefill.comment || '';
  form.dataset.start = prefill.startOffset ?? selectedOffsets().startOffset ?? '';
  form.dataset.end = prefill.endOffset ?? selectedOffsets().endOffset ?? '';
  $('hlProofReviewComment').focus();
}

function wireRight() {
  $('hlProofAddReview')?.addEventListener('click', () => openReviewForm());
  $('hlProofReview')?.addEventListener('click', () => openReviewForm());
  $('hlProofReviewCancel')?.addEventListener('click', () => { $('hlProofReviewForm').hidden = true; });
  $('hlProofReviewSave')?.addEventListener('click', saveReviewForm);
  document.querySelectorAll('[data-proof-review-status]').forEach(select => select.onchange = async () => { await getService().updateReviewWorkflow(select.dataset.proofReviewStatus, select.value); await reloadModel({ keepSelection: true, render: false }); renderRight(); updateCurrentStatus(); });
  document.querySelectorAll('[data-proof-anchor]').forEach(node => node.onclick = () => focusReviewAnchor(node.dataset.proofAnchor));
  $('hlProofRefreshFindings')?.addEventListener('click', runChecks);
  document.querySelectorAll('[data-finding-fix]').forEach(button => button.onclick = () => applyFinding(Number(button.dataset.findingFix)));
  document.querySelectorAll('[data-finding-review]').forEach(button => button.onclick = () => findingToReview(Number(button.dataset.findingReview)));
  document.querySelectorAll('[data-finding-ignore]').forEach(button => button.onclick = async () => { const finding = currentFindings[Number(button.dataset.findingIgnore)]; if (!finding) return; await getService().ignoreFinding(model.project.projectId, finding.key); await runChecks(); });
  $('hlProofAnalyzeStyle')?.addEventListener('click', analyzeStyle);
  $('hlProofSaveStyleGuide')?.addEventListener('click', async () => { await getService().saveStyleGuide(model.project.projectId, $('hlProofStyleGuide').value); await reloadModel({ keepSelection: true, render: false }); renderRight(); proofToast('Редакторская установка стиля сохранена.', 'success'); });
  $('hlProofAddTerm')?.addEventListener('click', addTerm);
  document.querySelectorAll('[data-remove-term]').forEach(button => button.onclick = async () => { await getService().removeDictionaryTerm(model.project.projectId, button.dataset.removeTerm); await reloadModel({ keepSelection: true, render: false }); renderRight(); });
  $('hlProofSaveForbidden')?.addEventListener('click', async () => { await getService().setForbiddenWords(model.project.projectId, $('hlProofForbidden').value); await reloadModel({ keepSelection: true, render: false }); renderRight(); });
}

async function saveReviewForm() {
  await saveEditorNow();
  const form = $('hlProofReviewForm');
  try {
    await getService().createReview(model.project.projectId, {
      fragmentId: selectedFragmentId,
      startOffset: form.dataset.start === '' ? null : Number(form.dataset.start),
      endOffset: form.dataset.end === '' ? null : Number(form.dataset.end),
      category: $('hlProofReviewCategory').value,
      severity: $('hlProofReviewSeverity').value,
      comment: $('hlProofReviewComment').value
    });
    await reloadModel({ keepSelection: true, render: false }); renderRight(); updateCurrentStatus();
  } catch (error) { alert(error.message || error); }
}

function focusReviewAnchor(reviewId) {
  const review = currentUnit()?.reviews?.find(item => item.reviewId === reviewId);
  const editor = $('hlProofEditor');
  if (!review?.resolvedAnchor || !editor || review.resolvedAnchor.startOffset == null) return;
  editor.focus(); editor.setSelectionRange(review.resolvedAnchor.startOffset, review.resolvedAnchor.endOffset);
}

async function runChecks() {
  await saveEditorNow();
  currentFindings = await getService().runChecks(model.project.projectId, selectedFragmentId);
  rightTab = 'quality'; renderRight(); $('hlProofRight')?.classList.add('open');
}

async function analyzeStyle() {
  try {
    await saveEditorNow();
    styleReport = await getService().analyzeNovel(model.project.projectId);
    rightTab = 'quality'; renderRight();
  } catch (error) { alert(error.message || error); }
}

async function applyFinding(index) {
  const finding = currentFindings[index]; if (!finding) return;
  await getService().applyFindingFix(model.project.projectId, selectedFragmentId, finding);
  await reloadModel({ keepSelection: true, render: false });
  currentFindings = await getService().runChecks(model.project.projectId, selectedFragmentId);
  renderWorkspace(); rightTab = 'quality'; renderRight();
}

function findingToReview(index) {
  const finding = currentFindings[index]; if (!finding) return;
  openReviewForm({ category: categoryForFinding(finding.code), severity: finding.severity === 'error' ? 'critical' : 'normal', comment: finding.message, startOffset: finding.startOffset, endOffset: finding.endOffset });
}

async function addTerm() {
  try {
    await getService().addDictionaryTerm(model.project.projectId, { canonical: $('hlProofTermCanonical').value, variants: $('hlProofTermVariants').value, note: $('hlProofTermNote').value });
    await reloadModel({ keepSelection: true, render: false }); renderRight();
  } catch (error) { alert(error.message || error); }
}

function updateCurrentStatus() {
  const unit = currentUnit(); const pill = $('hlProofStatus'); if (!unit || !pill) return;
  const open = unit.reviews?.filter(review => !['resolved','wont-fix'].includes(workflowStatusFromLegacy(review))).length || 0;
  if (open) { pill.dataset.status = 'attention'; pill.textContent = 'Есть замечания'; }
}

function openViewDialog() {
  let dialog = $('hlProofViewDialog');
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'hlProofViewDialog'; dialog.className = 'hl-proof-dialog hl-proof-view-dialog'; document.body.appendChild(dialog); }
  dialog.innerHTML = `<header class="hl-proof-dialog-head"><h2>Вид чтения</h2><button id="hlProofViewClose" class="hl-proof-small-button">Закрыть</button></header><div class="hl-proof-dialog-body"><div class="hl-proof-form"><label>Контекст<select id="hlProofContext"><option value="0">Без предыдущих реплик</option><option value="1">1 предыдущая</option><option value="2">2 предыдущие</option><option value="auto">Авто</option></select></label><label>Размер текста<input id="hlProofTextScale" type="range" min="0.9" max="1.3" step="0.05" value="${readerPrefs.textScale}"></label><label>Интерлиньяж<input id="hlProofLineHeight" type="range" min="1.4" max="1.85" step="0.05" value="${readerPrefs.lineHeight}"></label><label>Шрифт<select id="hlProofFont"><option value="serif">Литературный serif</option><option value="sans">Нейтральный sans-serif</option></select></label><label>Ширина текста<select id="hlProofColumnWidth"><option value="680">Узкая</option><option value="790">Стандартная</option><option value="900">Широкая</option></select></label><label class="hl-proof-checkbox"><input id="hlProofFocus" type="checkbox" ${readerPrefs.focus ? 'checked' : ''}> Режим фокуса</label></div></div>`;
  $('hlProofContext').value = String(readerPrefs.context);
  $('hlProofFont').value = readerPrefs.font;
  $('hlProofColumnWidth').value = String(readerPrefs.columnWidth);
  $('hlProofViewClose').onclick = () => dialog.close();
  const update = () => {
    readerPrefs = { ...readerPrefs, context: $('hlProofContext').value === 'auto' ? 'auto' : Number($('hlProofContext').value), textScale: Number($('hlProofTextScale').value), lineHeight: Number($('hlProofLineHeight').value), font: $('hlProofFont').value, columnWidth: Number($('hlProofColumnWidth').value), focus: $('hlProofFocus').checked };
    persistReaderPrefs();
    renderWorkspace();
  };
  ['hlProofContext','hlProofFont','hlProofColumnWidth','hlProofFocus'].forEach(id => $(id).onchange = update);
  ['hlProofTextScale','hlProofLineHeight'].forEach(id => $(id).oninput = update);
  dialog.showModal();
}

async function openSearchDialog() {
  await saveEditorNow();
  await reloadModel({ keepSelection: true, render: false });
  let dialog = $('hlProofSearchDialog');
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'hlProofSearchDialog'; dialog.className = 'hl-proof-dialog'; document.body.appendChild(dialog); }
  const chapter = currentChapter();
  dialog.innerHTML = `<header class="hl-proof-dialog-head"><h2>Поиск и безопасная замена</h2><button id="hlProofSearchClose" class="hl-proof-small-button">Закрыть</button></header><div class="hl-proof-dialog-body"><div class="hl-proof-form"><label>Найти<input id="hlProofSearchQuery"></label><label>Заменить<input id="hlProofSearchReplacement"></label><div class="hl-proof-inline"><label><input id="hlProofSearchRegex" type="checkbox"> Regex</label><label><input id="hlProofSearchCase" type="checkbox"> Учитывать регистр</label></div><label>Область<select id="hlProofSearchScope"><option value="all">Вся книга</option><option value="chapter">Текущая глава</option><option value="unreviewed">Только невычитанное</option><option value="changed">Изменённое после вычитки</option></select></label><button id="hlProofSearchPreview" class="hl-proof-small-button primary">Предпросмотр</button></div><div id="hlProofSearchSummary"></div><div id="hlProofSearchResults" class="hl-proof-search-results"></div></div><footer class="hl-proof-dialog-foot"><button id="hlProofReplaceCommit" class="button primary" disabled>Применить показанные замены</button></footer>`;
  $('hlProofSearchClose').onclick = () => dialog.close();
  $('hlProofSearchPreview').onclick = () => previewSearch(chapter?.chapterId);
  $('hlProofReplaceCommit').onclick = commitSearchReplace;
  dialog.showModal();
}

function previewSearch(chapterId) {
  try {
    searchPreview = getService().search(model, { query: $('hlProofSearchQuery').value, replacement: $('hlProofSearchReplacement').value, regex: $('hlProofSearchRegex').checked, caseSensitive: $('hlProofSearchCase').checked, scope: $('hlProofSearchScope').value, chapterId });
    $('hlProofSearchSummary').innerHTML = `<p>Совпадений: <b>${searchPreview.matchCount}</b> · фрагментов: <b>${searchPreview.fragmentCount}</b>. Ничего не записано до подтверждения.</p>`;
    $('hlProofSearchResults').innerHTML = searchPreview.results.slice(0, 100).map(item => `<article class="hl-proof-search-row"><header><strong>${esc(`${item.chapterTitle} · ${item.sceneTitle}`)}</strong><span>${item.matches.length}</span></header><pre>${esc(item.before)}</pre>${item.before !== item.after ? `<pre>→ ${esc(item.after)}</pre>` : ''}</article>`).join('');
    $('hlProofReplaceCommit').disabled = !searchPreview.results.some(item => item.before !== item.after);
  } catch (error) { $('hlProofSearchSummary').innerHTML = `<p style="color:#a33">${esc(error.message || error)}</p>`; $('hlProofReplaceCommit').disabled = true; }
}

async function commitSearchReplace() {
  if (!searchPreview) return;
  if (!confirm(`Применить замену в ${searchPreview.fragmentCount} фрагментах? Перед массовой операцией будет создана safety revision для source-backed проекта.`)) return;
  try {
    const result = await getService().commitReplace(model.project.projectId, searchPreview);
    if (window.HEARTLINEProjectCore?.flushSourceSave) await window.HEARTLINEProjectCore.flushSourceSave(model.project.projectId, 'autosave');
    $('hlProofSearchDialog')?.close();
    proofToast(`Изменено фрагментов: ${result.changedFragments}. Ранее вычитанные изменённые фрагменты помечены повторно.`, 'success');
    await reloadModel({ keepSelection: true });
  } catch (error) { alert(error.message || error); }
}

function adaptLegacyUi() {
  const acceptAll = $('acceptAllSafe'); if (acceptAll) acceptAll.textContent = 'Применить все технически совместимые';
  const reviewed = $('hlMarkReviewed'); const approved = $('hlMarkApproved');
  if (reviewed) reviewed.remove(); if (approved) approved.remove();
  const backup = $('hlCreateBackup');
  if (backup) {
    const card = backup.closest('.export-card');
    const paragraph = card?.querySelector('p');
    if (paragraph) paragraph.textContent = 'Backup исходника + HL context. Прогресс вычитки ведётся автоматически при чтении.';
  }
  document.querySelectorAll('.project-card-rich-foot .muted').forEach(node => {
    if (node.textContent.includes('Продолжить: Читать')) node.textContent = node.textContent.replace('Продолжить: Читать', 'Продолжить: Вычитка');
  });
  document.querySelectorAll('[data-hl-storyboard-more]').forEach(button => button.remove());
  const storyboard = document.querySelector('.mobile-nav [data-route="storyboard"]');
  if (storyboard) storyboard.style.display = '';
}

document.addEventListener('keydown', proofreadingHotkeys);
installStyles();
installNavigation();
adaptLegacyUi();
redirectLegacyReaderIfNeeded();

window.HEARTLINEProofreading = Object.freeze({
  open: openProofreading,
  get service() { return getService(); },
  enhance() { installNavigation(); adaptLegacyUi(); redirectLegacyReaderIfNeeded(); }
});
