import { BrowserProofreadingRepository } from '../infrastructure/browser-proofreading-repository.js';
import { ProofreadingService } from '../application/proofreading-service.js';
import { TEXT_REVIEW_CATEGORIES, workflowStatusFromLegacy } from '../domain/proofreading.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const repository = new BrowserProofreadingRepository();
let service = null;
let active = false;
let model = null;
let selectedFragmentId = null;
let rightTab = 'reviews';
let editorSaveTimer = null;
let editorSaving = false;
let lastEditorSavedValue = null;
let currentFindings = [];
let searchPreview = null;

function getService() {
  if (service) return service;
  service = new ProofreadingService({
    repository,
    projectService: window.HEARTLINEProjectCore?.projectService || null,
    uuid: () => crypto.randomUUID(),
    clock: () => new Date().toISOString()
  });
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
    'not-started': 'Не начато', 'in-progress': 'В работе', attention: 'Есть замечания',
    reviewed: 'Проверено', approved: 'Утверждено', changed: 'Изменено после проверки'
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

function currentUnit() { return model?.units?.find(unit => unit.fragmentId === selectedFragmentId) || null; }
function currentScene() { const unit = currentUnit(); return unit ? model.scenes.find(scene => scene.sceneId === unit.sceneId) : null; }
function currentChapter() { const unit = currentUnit(); return unit ? model.chapters.find(chapter => chapter.chapterId === unit.chapterId) : null; }

async function reloadModel({ keepSelection = true, render = true } = {}) {
  if (!model?.project?.projectId) return;
  const previous = keepSelection ? selectedFragmentId : null;
  model = await getService().load(model.project.projectId, model.state?.activePassId);
  if (previous && model.units.some(unit => unit.fragmentId === previous)) selectedFragmentId = previous;
  else selectedFragmentId = model.workspace.selectedFragmentId || getService().nextPending(model, null, 1)?.fragmentId || model.units[0]?.fragmentId || null;
  if (render) renderWorkspace();
}

async function openProofreading() {
  active = true;
  document.body.classList.add('hl-proofreading-active');
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

function installNavigation() {
  const desktop = $('mainNav');
  if (desktop && !$('hlProofreadingNav')) {
    const button = document.createElement('button');
    button.id = 'hlProofreadingNav';
    button.className = 'nav-button hl-proof-nav';
    button.type = 'button';
    button.textContent = 'Вычитка';
    const reader = desktop.querySelector('[data-route="reader"]');
    reader?.after(button);
    button.onclick = openProofreading;
  }
  const mobile = document.querySelector('.mobile-nav');
  if (mobile && !$('hlProofreadingMobileNav')) {
    const button = document.createElement('button');
    button.id = 'hlProofreadingMobileNav';
    button.className = 'nav-button hl-proof-nav';
    button.type = 'button';
    button.textContent = 'Вычитка';
    mobile.querySelector('[data-route="reader"]')?.after(button);
    button.onclick = openProofreading;
    const storyboard = mobile.querySelector('[data-route="storyboard"]');
    if (storyboard) storyboard.style.display = 'none';
  }
  document.querySelectorAll('[data-route],#brandButton').forEach(button => {
    if (button.dataset.hlProofLeaveBound) return;
    button.dataset.hlProofLeaveBound = '1';
    button.addEventListener('click', leaveProofreading, true);
  });
}

function progressHtml(progress) {
  return `<div class="hl-proof-progress"><div class="hl-proof-progress-bar"><i style="width:${progress.percent}%"></i></div><small>${progress.percent}%</small></div>`;
}

function outlineHtml() {
  const route = model.routeCoverage?.total
    ? `<div class="hl-proof-route-coverage"><h3>Проверочные маршруты · ${model.routeCoverage.completed}/${model.routeCoverage.total}</h3>${model.routeCoverage.routes.map(item => `<div class="hl-proof-route"><span>${esc(item.title)}</span><b>${item.percent}%</b></div>`).join('')}</div>`
    : '';
  return `<div class="hl-proof-book-summary">
    <div class="hl-proof-metric"><strong>${model.progress.percent}%</strong><span>проход</span></div>
    <div class="hl-proof-metric"><strong>${model.progress.counts.attention}</strong><span>с замечаниями</span></div>
    <div class="hl-proof-metric"><strong>${model.progress.counts.changed}</strong><span>изменено</span></div>
  </div>${model.chapters.map(chapter => `<details class="hl-proof-chapter" ${chapter.units.some(unit => unit.fragmentId === selectedFragmentId) ? 'open' : ''}>
    <summary><span class="hl-proof-dot"></span><strong>${esc(chapter.title)}</strong><small>${chapter.progress.percent}%</small></summary>
    ${chapter.scenes.map(scene => `<div class="hl-proof-scene ${scene.units.some(unit => unit.fragmentId === selectedFragmentId) ? 'open' : ''}" data-scene="${esc(scene.sceneId)}">
      <div class="hl-proof-scene-head"><strong>${esc(scene.title)}</strong><small>${scene.progress.percent}% · ${statusLabel(scene.progress.status)}</small></div>
      <div class="hl-proof-units">${scene.units.map(unit => `<button class="hl-proof-unit ${unit.fragmentId === selectedFragmentId ? 'active' : ''}" data-proof-unit="${esc(unit.fragmentId)}" data-status="${esc(unit.status)}"><i class="hl-proof-dot"></i><span class="excerpt">${esc(`${unit.speaker ? `${unit.speaker}: ` : ''}${unit.text}`)}</span><small>${unit.openReviewCount || ''}</small></button>`).join('')}</div>
    </div>`).join('')}</details>`).join('')}${route}`;
}

function contextText(unit, offset) {
  if (!unit) return '';
  const index = model.units.findIndex(item => item.fragmentId === unit.fragmentId);
  const candidate = model.units[index + offset];
  if (!candidate || candidate.sceneId !== unit.sceneId) return '';
  return `${candidate.speaker ? `${candidate.speaker}: ` : ''}${candidate.text}`;
}

function editorHtml() {
  const unit = currentUnit();
  if (!unit) return '<div class="hl-proof-empty">Нет текстовых фрагментов.</div>';
  return `<article class="hl-proof-editor-card">
    ${contextText(unit, -1) ? `<div class="hl-proof-context">${esc(contextText(unit, -1))}</div>` : ''}
    <header class="hl-proof-editor-head"><div><span class="kicker">${esc(model.activePass?.label || 'Вычитка')}</span><h2>${esc(`${unit.chapterTitle} · ${unit.sceneTitle}`)}</h2><p>${esc(`${unit.type}${unit.speaker ? ` · ${unit.speaker}` : ''} · ${unit.fragmentId}`)}</p></div><span id="hlProofStatus" class="hl-proof-status-pill" data-status="${esc(unit.status)}">${esc(statusLabel(unit.status))}</span></header>
    <div class="hl-proof-editor-wrap"><textarea id="hlProofEditor" class="hl-proof-editor" spellcheck="true">${esc(unit.text)}</textarea><div class="hl-proof-highlight-note">Выделите текст и нажмите «Замечание», чтобы сохранить устойчивую привязку с offsets и контекстом.</div></div>
    <div class="hl-proof-editor-actions"><button id="hlProofReview" class="button secondary small">Замечание</button><button id="hlProofRunChecks" class="button secondary small">Проверить</button><button id="hlProofMark" class="button primary small">✓ Проверено</button>${model.state.activePassId === 'final' ? '<button id="hlProofApprove" class="button secondary small">Утвердить</button>' : ''}<span id="hlProofSaveState" class="hl-proof-save-state">${esc(model.workspace.saveState || 'saved')}</span></div>
    ${contextText(unit, 1) ? `<div class="hl-proof-context next">${esc(contextText(unit, 1))}</div>` : ''}
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
    ${reviews.length ? reviews.map(review => `<article class="hl-proof-review-card" data-review-id="${esc(review.reviewId)}"><header><strong>${esc(review.category || 'Другое')}</strong><select class="select" data-proof-review-status="${esc(review.reviewId)}">${model.reviewWorkflowStates.map(status => `<option value="${status}" ${status === review.workflowStatus ? 'selected' : ''}>${esc(workflowLabel(status))}</option>`).join('')}</select></header>${review.quotedText ? `<blockquote class="hl-proof-quote" data-proof-anchor="${esc(review.reviewId)}">${esc(review.quotedText)}</blockquote>` : ''}${review.resolvedAnchor && ['stale','ambiguous'].includes(review.resolvedAnchor.status) ? `<div class="hl-proof-anchor-stale">Привязка к тексту устарела: ${esc(review.resolvedAnchor.status)}</div>` : ''}<p>${esc(review.comment)}</p>${review.automation?.source ? `<small>Источник предложения: ${esc(review.automation.source)}</small>` : ''}</article>`).join('') : '<div class="hl-proof-empty">Открытых и закрытых текстовых замечаний для этого фрагмента нет.</div>'}`;
}

function findingsHtml() {
  return `<div class="hl-proof-section-title"><h3>Локальные проверки</h3><button id="hlProofRefreshFindings" class="hl-proof-small-button">Запустить</button></div>${currentFindings.length ? currentFindings.map((finding, index) => `<article class="hl-proof-finding" data-severity="${esc(finding.severity)}"><header><strong>${esc(finding.message)}</strong><span class="hl-proof-finding-code">${esc(finding.code)}</span></header><p>Позиция ${finding.startOffset}–${finding.endOffset}</p><div class="hl-proof-inline">${finding.replacement != null ? `<button class="hl-proof-small-button primary" data-finding-fix="${index}">Исправить</button>` : ''}<button class="hl-proof-small-button" data-finding-review="${index}">В замечание</button><button class="hl-proof-small-button" data-finding-ignore="${index}">Игнорировать</button></div></article>`).join('') : '<div class="hl-proof-empty">Нажмите «Запустить». Проверки локальные и детерминированные; они не отправляют текст наружу.</div>'}`;
}

function dictionaryHtml() {
  const dictionary = model.state.dictionary;
  return `<div class="hl-proof-section-title"><h3>Словарь проекта</h3></div><div class="hl-proof-form"><label>Правильное написание<input id="hlProofTermCanonical" placeholder="Например: Лиарен"></label><label>Варианты/ошибки<textarea id="hlProofTermVariants" placeholder="Лиарэн, Лиарин"></textarea></label><label>Комментарий<input id="hlProofTermNote" placeholder="Имя персонажа"></label><button id="hlProofAddTerm" class="hl-proof-small-button primary">Добавить термин</button></div>
    <div style="margin-top:10px">${dictionary.terms.map(term => `<article class="hl-proof-term"><strong>${esc(term.canonical)}</strong><p>${esc(term.variants.join(', ') || 'без вариантов')}${term.note ? `<br>${esc(term.note)}` : ''}</p><button class="hl-proof-small-button" data-remove-term="${esc(term.id)}">Удалить</button></article>`).join('') || '<div class="hl-proof-empty">Терминов пока нет.</div>'}</div>
    <div class="hl-proof-form" style="margin-top:12px"><label>Нежелательные слова/формы<textarea id="hlProofForbidden">${esc(dictionary.forbiddenWords.join('\n'))}</textarea></label><button id="hlProofSaveForbidden" class="hl-proof-small-button">Сохранить список</button></div>
    <div class="hl-proof-section-title" style="margin-top:14px"><h3>Проходы вычитки</h3></div><div class="hl-proof-pass-list">${model.state.passes.map(pass => `<label class="hl-proof-pass-toggle"><input type="checkbox" data-proof-pass-toggle="${esc(pass.id)}" ${pass.enabled ? 'checked' : ''}><span><b>${esc(pass.label)}</b><small>${esc(pass.description)}</small></span></label>`).join('')}</div>`;
}

function rightBodyHtml() { return rightTab === 'checks' ? findingsHtml() : rightTab === 'dictionary' ? dictionaryHtml() : reviewsHtml(); }

function renderWorkspace() {
  const view = $('view');
  const unit = currentUnit();
  view.className = 'view';
  view.innerHTML = `<section class="hl-proofreading-shell"><header class="hl-proof-toolbar"><div class="hl-proof-title"><strong>Вычитка · ${esc(model.project.title)}</strong><span>${esc(model.activePass?.description || '')}</span></div><select id="hlProofPass" class="select">${model.state.passes.filter(pass => pass.enabled).map(pass => `<option value="${esc(pass.id)}" ${pass.id === model.state.activePassId ? 'selected' : ''}>${esc(pass.label)}</option>`).join('')}</select>${progressHtml(model.progress)}<button id="hlProofPrev" class="button secondary small">←</button><button id="hlProofNext" class="button primary small">Следующее непроверенное →</button><button id="hlProofSearch" class="button secondary small">Поиск / замена</button><button id="hlProofSceneDone" class="button secondary small">Сцена ✓</button><button id="hlProofChapterDone" class="button secondary small">Глава ✓</button>${model.state.activePassId === 'final' ? '<button id="hlProofBookDone" class="button secondary small">Книга ✓</button>' : ''}<button id="hlProofRightToggle" class="button secondary small hl-proof-right-toggle">Панель</button></header><div class="hl-proof-grid"><aside class="hl-proof-pane hl-proof-outline">${outlineHtml()}</aside><main class="hl-proof-pane hl-proof-center">${editorHtml()}</main><aside id="hlProofRight" class="hl-proof-pane hl-proof-right"><div class="hl-proof-right-tabs"><button data-proof-tab="reviews" class="${rightTab === 'reviews' ? 'active' : ''}">Замечания</button><button data-proof-tab="checks" class="${rightTab === 'checks' ? 'active' : ''}">Проверки</button><button data-proof-tab="dictionary" class="${rightTab === 'dictionary' ? 'active' : ''}">Словарь</button></div><div id="hlProofRightBody" class="hl-proof-right-body">${rightBodyHtml()}</div></aside></div></section>`;
  wireWorkspace(unit);
}

async function saveEditorNow({ flushSource = false } = {}) {
  clearTimeout(editorSaveTimer);
  const editor = $('hlProofEditor');
  const unit = currentUnit();
  if (!editor || !unit || editorSaving) return;
  const value = editor.value;
  if (lastEditorSavedValue === null) lastEditorSavedValue = unit.text;
  if (value === lastEditorSavedValue) return;
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

async function selectUnit(fragmentId) {
  await saveEditorNow();
  const unit = model.units.find(item => item.fragmentId === fragmentId);
  if (!unit) return;
  selectedFragmentId = fragmentId;
  currentFindings = [];
  lastEditorSavedValue = null;
  await repository.setWorkspaceSelection(model.project.projectId, { fragmentId, sceneId: unit.sceneId }).catch(() => {});
  await reloadModel({ keepSelection: true, render: true });
}

function wireWorkspace(unit) {
  lastEditorSavedValue = unit?.text ?? null;
  $('hlProofPass')?.addEventListener('change', async event => { await saveEditorNow(); await getService().selectPass(model.project.projectId, event.target.value); await reloadModel({ keepSelection: true }); });
  $('hlProofEditor')?.addEventListener('input', () => { clearTimeout(editorSaveTimer); $('hlProofSaveState').textContent = 'dirty'; editorSaveTimer = setTimeout(() => saveEditorNow(), 650); });
  $('hlProofEditor')?.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveEditorNow({ flushSource: true }); } });
  document.querySelectorAll('[data-proof-unit]').forEach(button => button.onclick = () => selectUnit(button.dataset.proofUnit));
  document.querySelectorAll('.hl-proof-scene-head').forEach(head => head.onclick = () => head.closest('.hl-proof-scene')?.classList.toggle('open'));
  $('hlProofNext')?.addEventListener('click', async () => { await saveEditorNow(); await reloadModel({ keepSelection: true, render: false }); const next = getService().nextPending(model, selectedFragmentId, 1); if (next) selectUnit(next.fragmentId); });
  $('hlProofPrev')?.addEventListener('click', async () => { await saveEditorNow(); const index = model.units.findIndex(item => item.fragmentId === selectedFragmentId); if (index > 0) selectUnit(model.units[index - 1].fragmentId); });
  $('hlProofMark')?.addEventListener('click', () => markCurrent(false));
  $('hlProofApprove')?.addEventListener('click', () => markCurrent(true));
  $('hlProofSceneDone')?.addEventListener('click', () => markScope('scene'));
  $('hlProofChapterDone')?.addEventListener('click', () => markScope('chapter'));
  $('hlProofBookDone')?.addEventListener('click', () => markScope('book'));
  $('hlProofSearch')?.addEventListener('click', openSearchDialog);
  $('hlProofRightToggle')?.addEventListener('click', () => $('hlProofRight')?.classList.toggle('open'));
  document.querySelectorAll('[data-proof-tab]').forEach(button => button.onclick = () => { rightTab = button.dataset.proofTab; currentFindings = rightTab === 'checks' ? currentFindings : currentFindings; renderRight(); });
  wireRight();
}

async function markCurrent(approved) {
  await saveEditorNow({ flushSource: true });
  try { await getService().markUnit(model.project.projectId, selectedFragmentId, { approved }); await reloadModel({ keepSelection: true }); }
  catch (error) { alert(error.message || error); rightTab = 'reviews'; renderRight(); }
}

async function markScope(scope) {
  await saveEditorNow({ flushSource: true });
  const unit = currentUnit();
  if (!unit) return;
  try {
    let result;
    if (scope === 'book') result = await getService().markProject(model.project.projectId, { approved: true });
    else result = await getService().markScope(model.project.projectId, scope === 'scene' ? { sceneId: unit.sceneId } : { chapterId: unit.chapterId });
    if (result.skipped?.length) alert(`Проверено: ${result.completed}. Пропущено из-за открытых замечаний: ${result.skipped.length}.`);
    await reloadModel({ keepSelection: true });
  } catch (error) { alert(error.message || error); }
}

function renderRight() {
  const body = $('hlProofRightBody');
  if (!body) return;
  document.querySelectorAll('[data-proof-tab]').forEach(button => button.classList.toggle('active', button.dataset.proofTab === rightTab));
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
  $('hlProofRunChecks')?.addEventListener('click', runChecks);
  $('hlProofRefreshFindings')?.addEventListener('click', runChecks);
  document.querySelectorAll('[data-finding-fix]').forEach(button => button.onclick = () => applyFinding(Number(button.dataset.findingFix)));
  document.querySelectorAll('[data-finding-review]').forEach(button => button.onclick = () => findingToReview(Number(button.dataset.findingReview)));
  document.querySelectorAll('[data-finding-ignore]').forEach(button => button.onclick = async () => { const finding = currentFindings[Number(button.dataset.findingIgnore)]; if (!finding) return; await getService().ignoreFinding(model.project.projectId, finding.key); await runChecks(); });
  $('hlProofAddTerm')?.addEventListener('click', addTerm);
  document.querySelectorAll('[data-remove-term]').forEach(button => button.onclick = async () => { await getService().removeDictionaryTerm(model.project.projectId, button.dataset.removeTerm); await reloadModel({ keepSelection: true, render: false }); renderRight(); });
  $('hlProofSaveForbidden')?.addEventListener('click', async () => { await getService().setForbiddenWords(model.project.projectId, $('hlProofForbidden').value); await reloadModel({ keepSelection: true, render: false }); renderRight(); });
  document.querySelectorAll('[data-proof-pass-toggle]').forEach(input => input.onchange = async () => { await getService().setPassEnabled(model.project.projectId, input.dataset.proofPassToggle, input.checked); await reloadModel({ keepSelection: true }); });
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
  rightTab = 'checks'; renderRight();
}

async function applyFinding(index) {
  const finding = currentFindings[index]; if (!finding) return;
  await getService().applyFindingFix(model.project.projectId, selectedFragmentId, finding);
  await reloadModel({ keepSelection: true, render: false });
  currentFindings = await getService().runChecks(model.project.projectId, selectedFragmentId);
  renderWorkspace(); rightTab = 'checks'; renderRight();
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

async function openSearchDialog() {
  await saveEditorNow();
  await reloadModel({ keepSelection: true, render: false });
  let dialog = $('hlProofSearchDialog');
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'hlProofSearchDialog'; dialog.className = 'hl-proof-dialog'; document.body.appendChild(dialog); }
  const chapter = currentChapter();
  dialog.innerHTML = `<header class="hl-proof-dialog-head"><h2>Поиск и безопасная замена</h2><button id="hlProofSearchClose" class="hl-proof-small-button">Закрыть</button></header><div class="hl-proof-dialog-body"><div class="hl-proof-form"><label>Найти<input id="hlProofSearchQuery"></label><label>Заменить<input id="hlProofSearchReplacement"></label><div class="hl-proof-inline"><label><input id="hlProofSearchRegex" type="checkbox"> Regex</label><label><input id="hlProofSearchCase" type="checkbox"> Учитывать регистр</label></div><label>Область<select id="hlProofSearchScope"><option value="all">Вся книга</option><option value="chapter">Текущая глава</option><option value="unreviewed">Только непроверенное</option><option value="changed">Изменённое после проверки</option></select></label><button id="hlProofSearchPreview" class="hl-proof-small-button primary">Предпросмотр</button></div><div id="hlProofSearchSummary"></div><div id="hlProofSearchResults" class="hl-proof-search-results"></div></div><footer class="hl-proof-dialog-foot"><button id="hlProofReplaceCommit" class="button primary" disabled>Применить показанные замены</button></footer>`;
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
    alert(`Изменено фрагментов: ${result.changedFragments}. Проверенные ранее фрагменты автоматически помечены как изменённые по content hash.`);
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
    if (paragraph) paragraph.textContent = 'Backup исходника + HL context. Статус вычитки теперь управляется в отдельном режиме «Вычитка».';
  }
  const more = $('modalBody');
  const title = $('modalTitle');
  if (more && title?.textContent === 'Ещё' && !more.querySelector('[data-hl-storyboard-more]')) {
    const button = document.createElement('button'); button.className = 'button secondary'; button.dataset.hlStoryboardMore = '1'; button.textContent = 'Сториборд';
    button.onclick = () => { $('modalClose')?.click(); document.querySelector('.mobile-nav [data-route="storyboard"]')?.click(); };
    more.querySelector('.mobile-more-grid')?.prepend(button);
  }
}

const observer = new MutationObserver(() => { installNavigation(); adaptLegacyUi(); });
observer.observe(document.documentElement, { childList: true, subtree: true });
installStyles();
installNavigation();
adaptLegacyUi();

window.HEARTLINEProofreading = Object.freeze({ open: openProofreading, get service() { return getService(); } });
