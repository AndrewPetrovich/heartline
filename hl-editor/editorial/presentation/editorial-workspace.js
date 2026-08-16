import { getAppServices } from '../../application/service-container.js';
import { renderPlayerFrame, renderDeviceComparison } from '../../../heartline-player-renderer.js';

const STYLE_ID = 'hlEditorialWorkspaceStyles';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

const services = getAppServices();
const workflowService = services.editorialWorkflowService;
const deviceProfileService = services.deviceProfileService;
const proofreadingService = services.proofreadingService;
const autosaveDelayMs = Math.max(500, Number(services.policies?.autosaveDelayMs || 1200));

let active = false;
let model = null;
let stage = 'text';
let selectedFragmentId = null;
let editorTimer = null;
let toastTimer = null;
let reviewFormOpen = false;
let finalEditOpen = false;
let previewDeviceId = deviceProfileService.defaultProfile().id;
let previewOrientation = 'portrait';
let previewShowSafeArea = false;
let previewCompare = false;
let previewRenderGeneration = 0;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./editorial-workspace.css', import.meta.url).href;
  document.head.appendChild(link);
}

function toast(message, kind = 'info') {
  let node = $('hlEditorialToast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'hlEditorialToast';
    node.className = 'hl-editorial-toast';
    document.body.appendChild(node);
  }
  clearTimeout(toastTimer);
  node.dataset.kind = kind;
  node.textContent = String(message || '');
  node.classList.add('visible');
  toastTimer = setTimeout(() => node.classList.remove('visible'), 3000);
}

function currentUnit() {
  return model?.units?.find(unit => unit.fragmentId === selectedFragmentId) || null;
}

function unitIndex() {
  return Math.max(0, model?.units?.findIndex(unit => unit.fragmentId === selectedFragmentId) ?? 0);
}

function stageInfo(name) {
  return model?.stages?.[name] || { percent: 0, completed: 0, remaining: 0 };
}

function stageLabel(name) {
  return ({ text: 'Вычитка', visual: 'Визуалы', final: 'Финальная проверка' })[name] || name;
}

function stageNumber(name) {
  return ({ text: 1, visual: 2, final: 3 })[name] || 0;
}

function stageStatus(unit, name = stage) {
  if (!unit) return 'not-started';
  if (name === 'text') return unit.textStatus;
  if (name === 'visual') return unit.visualReady ? 'reviewed' : 'not-started';
  return unit.finalStatus;
}

function contextUnits(unit, direction, limit = 2) {
  if (!unit) return [];
  const index = model.units.findIndex(item => item.fragmentId === unit.fragmentId);
  const out = [];
  for (let step = 1; step <= limit; step++) {
    const candidate = model.units[index + direction * step];
    if (!candidate || candidate.sceneId !== unit.sceneId) break;
    direction < 0 ? out.unshift(candidate) : out.push(candidate);
  }
  return out;
}

function contextHtml(unit, direction) {
  return contextUnits(unit, direction, direction < 0 ? 2 : 1)
    .map(item => `<div class="hl-editorial-context ${direction > 0 ? 'next' : ''}">${item.speaker ? `<strong>${esc(item.speaker)}</strong> ` : ''}${esc(item.text)}</div>`)
    .join('');
}

function stageTabsHtml() {
  return `<div class="hl-editorial-stage-tabs">${['text', 'visual', 'final'].map(name => {
    const info = stageInfo(name);
    return `<button type="button" class="hl-editorial-stage ${stage === name ? 'active' : ''}" data-editorial-stage="${name}">
      <span class="hl-editorial-stage-index">${stageNumber(name)}</span>
      <span class="hl-editorial-stage-copy"><strong>${stageLabel(name)}</strong><small>${info.percent}% · ${info.completed}/${model.stages.total}</small></span>
      <i aria-hidden="true"><b style="width:${info.percent}%"></b></i>
    </button>`;
  }).join('')}</div>`;
}

function outlineHtml() {
  const lookup = new Map(model.units.map(unit => [unit.fragmentId, unit]));
  return `<div class="hl-editorial-summary">
      <div><strong>${stageInfo('text').percent}%</strong><span>текст</span></div>
      <div><strong>${stageInfo('visual').percent}%</strong><span>визуалы</span></div>
      <div><strong>${stageInfo('final').percent}%</strong><span>финал</span></div>
    </div>
    ${model.chapters.map(chapter => `<details class="hl-editorial-chapter" ${chapter.units.some(unit => unit.fragmentId === selectedFragmentId) ? 'open' : ''}>
      <summary><strong>${esc(chapter.title)}</strong><small>${chapter.units.length}</small></summary>
      ${chapter.scenes.map(scene => `<section class="hl-editorial-scene">
        <header><strong>${esc(scene.title)}</strong></header>
        <div>${scene.units.map(source => {
          const unit = lookup.get(source.fragmentId);
          const status = stageStatus(unit);
          const excerpt = `${unit?.speaker ? `${unit.speaker}: ` : ''}${unit?.text || ''}`;
          return `<button type="button" class="hl-editorial-unit ${unit?.fragmentId === selectedFragmentId ? 'active' : ''}" data-editorial-unit="${esc(unit?.fragmentId)}" data-status="${esc(status)}">
            <i></i><span>${esc(excerpt)}</span>
          </button>`;
        }).join('')}</div>
      </section>`).join('')}
    </details>`).join('')}`;
}

function textCenterHtml(unit) {
  return `<article class="hl-editorial-text-card">
    ${contextHtml(unit, -1)}
    <header><div><span class="kicker">ВЫЧИТКА</span><h2>${esc(`${unit.chapterTitle} · ${unit.sceneTitle}`)}</h2><p>${esc(`${unit.type}${unit.speaker ? ` · ${unit.speaker}` : ''}`)}</p></div><span class="hl-editorial-status" data-status="${esc(unit.textStatus)}">${esc(unit.textStatus === 'reviewed' || unit.textStatus === 'approved' ? 'Вычитано' : unit.textStatus === 'changed' ? 'Изменено' : unit.textStatus === 'attention' ? 'Есть замечания' : 'Не вычитано')}</span></header>
    <div class="hl-editorial-editor-wrap">
      <textarea id="hlEditorialTextEditor" class="hl-editorial-text-editor" spellcheck="true">${esc(unit.text)}</textarea>
      <p>Исправления сохраняются автоматически. «Далее» отмечает актуальный текст вычитанным, если нет открытых замечаний.</p>
    </div>
    ${contextHtml(unit, 1)}
  </article>`;
}

function deviceOptionsHtml() {
  return deviceProfileService.groupedProfiles().map(group =>
    `<optgroup label="${esc(group.family)}">${group.profiles.map(device => `<option value="${esc(device.id)}" ${device.id === previewDeviceId ? 'selected' : ''}>${esc(device.label)}</option>`).join('')}</optgroup>`
  ).join('');
}

function previewToolbarHtml() {
  return `<div class="hl-editorial-preview-toolbar">
    <label><span>Устройство</span><select id="hlEditorialDevice">${deviceOptionsHtml()}</select></label>
    <label><span>Ориентация</span><select id="hlEditorialOrientation"><option value="portrait">Вертикальная</option><option value="landscape">Горизонтальная</option></select></label>
    ${stage === 'final' ? `<button id="hlEditorialCompare" type="button" class="button secondary small">${previewCompare ? 'Одно устройство' : 'Сравнить основные'}</button>` : ''}
    <label class="hl-editorial-toggle"><input id="hlEditorialSafeArea" type="checkbox" ${previewShowSafeArea ? 'checked' : ''}><span>Safe area</span></label>
  </div>`;
}

function visualCenterHtml(unit) {
  const finalEditor = stage === 'final' && finalEditOpen
    ? `<div class="hl-editorial-final-center-edit">
        <div class="hl-editorial-final-center-head"><strong>Редактирование текста</strong><span>Изменение текста автоматически сбросит актуальность финальной проверки.</span></div>
        <textarea id="hlEditorialFinalEditor" spellcheck="true">${esc(unit.text)}</textarea>
        <div class="hl-editorial-final-center-actions">
          <button id="hlEditorialCancelFinalText" type="button" class="button secondary">Отмена</button>
          <button id="hlEditorialSaveFinalText" type="button" class="button primary">Сохранить текст</button>
        </div>
      </div>`
    : '';
  const caption = stage === 'final'
    ? `<button id="hlEditorialEditCaption" type="button" class="hl-editorial-preview-caption editable" title="Редактировать текст">
        <strong>${esc(unit.speaker || unit.type)}</strong>
        <span>${esc(unit.text)}</span>
        <em>Редактировать</em>
      </button>`
    : `<div class="hl-editorial-preview-caption">
        <strong>${esc(unit.speaker || unit.type)}</strong>
        <span>${esc(unit.text)}</span>
      </div>`;
  return `<section class="hl-editorial-preview-center ${finalEditOpen ? 'editing-text' : ''}">
    ${previewToolbarHtml()}
    <div id="hlEditorialPreviewCanvas" class="hl-editorial-preview-canvas" aria-live="polite"></div>
    ${finalEditor || caption}
  </section>`;
}

function reviewCardHtml(review) {
  const statuses = model.reviewWorkflowStates || ['open', 'fix-proposed', 'verify', 'resolved', 'wont-fix'];
  const labels = { open: 'Открыто', 'fix-proposed': 'Исправление предложено', verify: 'Проверить', resolved: 'Решено', 'wont-fix': 'Не исправлять' };
  return `<article class="hl-editorial-review">
    <header><strong>${esc(review.category || 'Другое')}</strong><select data-editorial-review-status="${esc(review.reviewId)}">${statuses.map(status => `<option value="${status}" ${status === review.workflowStatus ? 'selected' : ''}>${esc(labels[status] || status)}</option>`).join('')}</select></header>
    ${review.quotedText ? `<blockquote>${esc(review.quotedText)}</blockquote>` : ''}
    <p>${esc(review.comment || '')}</p>
  </article>`;
}

function reviewPanelHtml(unit, { includeAll = false } = {}) {
  return `<section class="hl-editorial-panel-section">
    <div class="hl-editorial-panel-title"><h3>Замечания</h3><button id="hlEditorialAddReview" class="button secondary small">+ Замечание</button></div>
    <div id="hlEditorialReviewForm" class="hl-editorial-review-form" ${reviewFormOpen ? '' : 'hidden'}>
      <label>Категория<select id="hlEditorialReviewCategory">${model.categories.map(item => `<option>${esc(item)}</option>`).join('')}</select></label>
      <label>Комментарий<textarea id="hlEditorialReviewComment" placeholder="Что исправить и почему?"></textarea></label>
      <div><button id="hlEditorialCancelReview" class="button secondary small">Отмена</button><button id="hlEditorialSaveReview" class="button primary small">Сохранить</button></div>
    </div>
    <div class="hl-editorial-review-list">${(includeAll ? unit.allReviews : unit.reviews)?.length ? (includeAll ? unit.allReviews : unit.reviews).map(reviewCardHtml).join('') : `<p class="muted">${includeAll ? 'Открытых замечаний нет.' : 'Открытых текстовых замечаний нет.'}</p>`}</div>
  </section>`;
}

function visualPanelHtml(unit, { final = false } = {}) {
  const assignment = unit.assignment || {};
  return `<section class="hl-editorial-panel-section">
    <div class="hl-editorial-panel-title"><h3>${final ? 'Кадр и изображение' : 'Изображение'}</h3><span class="hl-editorial-status" data-status="${unit.visualReady ? 'reviewed' : 'attention'}">${unit.visualReady ? 'Назначено' : 'Нет изображения'}</span></div>
    ${unit.visualReady ? `<p class="hl-editorial-asset-name">${esc(unit.asset?.name || unit.assetId || 'Изображение')}</p>` : '<p class="muted">Загрузите изображение для этого фрагмента. Оно сразу появится в Preview.</p>'}
    <div class="hl-editorial-panel-actions">
      <button id="hlEditorialUploadVisual" class="button ${unit.visualReady ? 'secondary' : 'primary'}">${unit.visualReady ? 'Заменить изображение' : '+ Загрузить изображение'}</button>
      ${model.assets?.length ? `<div class="hl-editorial-library-pick"><select id="hlEditorialExistingAsset"><option value="">Из библиотеки…</option>${model.assets.map(asset => `<option value="${esc(asset.assetId)}" ${asset.assetId === unit.assetId ? 'selected' : ''}>${esc(asset.name || asset.assetId)}</option>`).join('')}</select><button id="hlEditorialAssignExisting" class="button secondary">Назначить</button></div>` : ''}
    </div>
    ${unit.visualReady ? `<label class="hl-editorial-range"><span>Zoom <b id="hlEditorialZoomValue">${Number(assignment.zoom || 1).toFixed(2)}×</b></span><input id="hlEditorialZoom" type="range" min="1" max="2.2" step=".02" value="${Number(assignment.zoom || 1)}"></label>
      <label class="hl-editorial-range"><span>Панель <b>${Math.round(Number(assignment.overlayOpacity || 0) * 100)}%</b></span><input id="hlEditorialOverlay" type="range" min="0" max=".35" step=".01" value="${Number(assignment.overlayOpacity || 0)}"></label>` : ''}
  </section>`;
}

function readinessItem(ok, label, detail = '') {
  return `<div class="hl-editorial-ready-item" data-ok="${ok ? 'true' : 'false'}"><i>${ok ? '✓' : '!'}</i><span><strong>${esc(label)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span></div>`;
}

function finalPanelHtml(unit) {
  const diagnosticErrors = unit.diagnostics.flatMap(item => item.warnings || []).filter(item => item.level === 'error');
  const diagnosticWarnings = unit.diagnostics.flatMap(item => item.warnings || []).filter(item => item.level === 'warning');
  return `<section class="hl-editorial-panel-section">
    <div class="hl-editorial-panel-title"><h3>Готовность кадра</h3><span class="hl-editorial-status" data-status="${esc(unit.finalStatus)}">${unit.finalStatus === 'reviewed' ? 'Проверено' : unit.finalStatus === 'changed' ? 'Изменено' : unit.finalStatus === 'attention' ? 'Требует внимания' : 'Не проверено'}</span></div>
    <div class="hl-editorial-ready-list">
      ${readinessItem(unit.textReady, 'Текст вычитан', unit.textReady ? 'Актуальная версия текста подтверждена.' : 'При «Далее» HEARTLINE попробует подтвердить текущий текст.')}
      ${readinessItem(unit.visualReady, 'Изображение назначено', unit.visualReady ? (unit.asset?.name || '') : 'Загрузите изображение.')}
      ${readinessItem(unit.openAllReviewCount === 0, 'Замечания закрыты', unit.openAllReviewCount ? `Открыто: ${unit.openAllReviewCount}` : 'Открытых замечаний нет.')}
      ${readinessItem(diagnosticErrors.length === 0, 'Preview без критических ошибок', diagnosticErrors.length ? `Ошибок: ${diagnosticErrors.length}` : `Предупреждений: ${diagnosticWarnings.length}`)}
    </div>
    <div class="hl-editorial-panel-actions">
      <button id="hlEditorialEditFinalText" class="button secondary">${finalEditOpen ? 'Закрыть редактор' : 'Редактировать текст'}</button>
      <button id="hlEditorialFinalReview" class="button secondary">+ Замечание</button>
    </div>
    ${unit.diagnostics.flatMap(item => item.warnings.map(warning => ({ ...warning, device: item.device.label }))).slice(0, 6).map(warning => `<div class="hl-editorial-diagnostic" data-level="${esc(warning.level)}"><strong>${esc(warning.device)}</strong><span>${esc(warning.text)}</span></div>`).join('')}
  </section>
  ${visualPanelHtml(unit, { final: true })}
  ${reviewPanelHtml(unit, { includeAll: true })}`;
}

function sidePanelHtml(unit) {
  if (stage === 'text') return reviewPanelHtml(unit);
  if (stage === 'visual') return visualPanelHtml(unit);
  return finalPanelHtml(unit);
}

function renderWorkspace() {
  previewRenderGeneration += 1;
  const unit = currentUnit();
  const view = $('view');
  if (!view) return;
  if (!unit) {
    view.className = 'view';
    view.innerHTML = '<section class="page"><div class="empty-state"><div><h2>Нет текстовых фрагментов</h2></div></div></section>';
    return;
  }

  document.body.classList.add('hl-proofreading-active', 'hl-editorial-active');
  document.body.classList.remove('reader-active');
  view.className = 'view hl-editorial-view';
  view.innerHTML = `<section class="hl-editorial-shell hl-proofreading-shell" data-stage="${stage}">
    <header class="hl-editorial-topbar">
      <div><span class="kicker">РЕДАКТОРСКИЙ ПРОЦЕСС</span><strong>${esc(model.project.title)}</strong></div>
      ${stageTabsHtml()}
    </header>
    <div class="hl-editorial-grid">
      <aside class="hl-editorial-outline">${outlineHtml()}</aside>
      <main class="hl-editorial-center">${stage === 'text' ? textCenterHtml(unit) : visualCenterHtml(unit)}</main>
      <aside class="hl-editorial-panel">${sidePanelHtml(unit)}</aside>
    </div>
    <footer class="hl-editorial-footer">
      <button id="hlEditorialFirst" class="button secondary">Первая</button>
      <button id="hlEditorialPrev" class="button secondary">← Назад</button>
      <button id="hlEditorialNext" class="button primary">${stage === 'text' ? 'Вперёд →' : stage === 'visual' ? 'Следующий кадр →' : 'Проверить и далее →'}</button>
      <button id="hlEditorialLast" class="button secondary">Последняя</button>
      <span>${unitIndex() + 1} / ${model.units.length}</span>
    </footer>
    <input id="hlEditorialVisualInput" type="file" accept="image/*" hidden>
  </section>`;

  bindWorkspace();
  if (stage !== 'text') renderPreview().catch(error => toast(error.message || error, 'error'));
}

async function reload({ keepSelection = true } = {}) {
  if (!model?.project?.projectId) return;
  const previous = keepSelection ? selectedFragmentId : null;
  model = await workflowService.load(model.project.projectId);
  if (previous && model.units.some(unit => unit.fragmentId === previous)) selectedFragmentId = previous;
  else selectedFragmentId = model.workspace.selectedFragmentId || model.units[0]?.fragmentId || null;
  renderWorkspace();
}

async function selectUnit(fragmentId) {
  const unit = model.units.find(item => item.fragmentId === fragmentId);
  if (!unit) return;
  if (fragmentId !== selectedFragmentId) await flushPendingFinalText();
  selectedFragmentId = fragmentId;
  await workflowService.setSelection(model.project.projectId, unit);
  reviewFormOpen = false;
  finalEditOpen = false;
  renderWorkspace();
}


async function flushPendingText() {
  if (stage !== 'text') return;
  clearTimeout(editorTimer);
  const editor = $('hlEditorialTextEditor');
  const unit = currentUnit();
  if (!editor || !unit || editor.value === unit.text) return;
  await workflowService.saveText(model.project.projectId, unit.fragmentId, editor.value, 'editorial-text-navigation');
  model = await workflowService.load(model.project.projectId);
}

async function changeStage(nextStage) {
  if (!['text', 'visual', 'final'].includes(nextStage) || nextStage === stage) return;
  await flushPendingText();
  await flushPendingFinalText();
  stage = nextStage;
  reviewFormOpen = false;
  finalEditOpen = false;
  await workflowService.setActiveStage(model.project.projectId, stage);
  renderWorkspace();
}

async function saveTextFromEditor(value, reason) {
  const unit = currentUnit();
  if (!unit) return;
  const result = await workflowService.saveText(model.project.projectId, unit.fragmentId, value, reason);
  if (result.changed) await reload();
}

async function saveFinalText(value) {
  const unit = currentUnit();
  if (!unit) return;
  await workflowService.saveText(model.project.projectId, unit.fragmentId, value, 'editorial-final-edit');
  finalEditOpen = false;
  await reload();
}

async function flushPendingFinalText() {
  if (stage !== 'final' || !finalEditOpen) return;
  clearTimeout(editorTimer);
  const editor = $('hlEditorialFinalEditor');
  const unit = currentUnit();
  if (!editor || !unit || editor.value === unit.text) return;
  await workflowService.saveText(model.project.projectId, unit.fragmentId, editor.value, 'editorial-final-navigation');
  model = await workflowService.load(model.project.projectId);
}

async function persistFinalTextDraft() {
  const editor = $('hlEditorialFinalEditor');
  const unit = currentUnit();
  if (!editor || !unit || editor.value === unit.text) return { changed: false };
  const value = editor.value;
  const fragmentId = unit.fragmentId;
  const result = await workflowService.saveText(model.project.projectId, fragmentId, value, 'editorial-final-autosave');
  const current = model?.units?.find(item => item.fragmentId === fragmentId);
  if (current && current.fragmentId === selectedFragmentId) {
    current.text = value;
    current.textReady = false;
    current.textStatus = 'changed';
    current.finalReady = false;
    current.finalStatus = 'changed';
  }
  return result;
}

function scheduleFinalTextDraftSave() {
  clearTimeout(editorTimer);
  editorTimer = setTimeout(() => {
    persistFinalTextDraft().catch(error => toast(error.message || error, 'error'));
  }, autosaveDelayMs);
}

function openFinalEditor() {
  if (stage !== 'final') return;
  finalEditOpen = true;
  renderWorkspace();
  requestAnimationFrame(() => {
    const editor = $('hlEditorialFinalEditor');
    editor?.focus();
    if (editor) editor.setSelectionRange(editor.value.length, editor.value.length);
  });
}

function closeFinalEditor() {
  finalEditOpen = false;
  renderWorkspace();
}

function scheduleTextSave() {
  clearTimeout(editorTimer);
  const editor = $('hlEditorialTextEditor');
  if (!editor) return;
  editorTimer = setTimeout(() => {
    saveTextFromEditor(editor.value, 'editorial-text-autosave').catch(error => toast(error.message || error, 'error'));
  }, autosaveDelayMs);
}

async function saveReview() {
  const unit = currentUnit();
  const comment = $('hlEditorialReviewComment')?.value?.trim();
  if (!unit || !comment) return toast('Введите комментарий', 'warning');
  let startOffset = null;
  let endOffset = null;
  const editor = $('hlEditorialTextEditor') || $('hlEditorialFinalEditor');
  if (editor && editor.selectionEnd > editor.selectionStart) {
    startOffset = editor.selectionStart;
    endOffset = editor.selectionEnd;
  }
  await workflowService.createReview(model.project.projectId, {
    fragmentId: unit.fragmentId,
    startOffset,
    endOffset,
    category: $('hlEditorialReviewCategory')?.value || 'Другое',
    severity: 'normal',
    comment
  });
  reviewFormOpen = false;
  await reload();
}

async function uploadVisual(file) {
  const unit = currentUnit();
  if (!unit || !file) return;
  await workflowService.importVisual(model.project.projectId, unit.fragmentId, file);
  toast('Изображение назначено', 'success');
  await reload();
}

async function updateVisual(patch) {
  const unit = currentUnit();
  if (!unit) return;
  await workflowService.updateVisual(model.project.projectId, unit.fragmentId, patch);
  await reload();
}

async function nextPaint() {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function renderPreviewFailure(host, error) {
  if (!host) return;
  const message = String(error?.message || error || 'Не удалось отрисовать Preview');
  host.innerHTML = `<div class="hl-editorial-preview-error" role="alert">
    <strong>Preview временно недоступен</strong>
    <span>${esc(message)}</span>
    <button id="hlEditorialRetryPreview" type="button" class="button secondary small">Повторить</button>
  </div>`;
  $('hlEditorialRetryPreview')?.addEventListener('click', () => renderPreview().catch(() => {}));
}

async function renderPreview() {
  const generation = ++previewRenderGeneration;
  const unit = currentUnit();
  const host = $('hlEditorialPreviewCanvas');
  if (!unit || !host) return;

  host.dataset.renderState = 'loading';
  await nextPaint();
  if (generation !== previewRenderGeneration || !host.isConnected || currentUnit()?.fragmentId !== unit.fragmentId) return;

  try {
    const assetUrl = unit.assetId ? await workflowService.assetObjectUrl(unit.assetId) : null;
    if (generation !== previewRenderGeneration || !host.isConnected || currentUnit()?.fragmentId !== unit.fragmentId) return;

    const frame = {
      fragmentId: unit.fragmentId,
      sceneId: unit.sceneId,
      sceneTitle: unit.sceneTitle,
      type: unit.type,
      speaker: unit.speaker,
      text: unit.text,
      options: unit.options || [],
      visualPrompt: unit.sceneTitle,
      assignment: unit.assignment,
      asset: unit.asset
    };

    const bounds = host.getBoundingClientRect();
    const center = host.closest('.hl-editorial-center')?.getBoundingClientRect();
    const fitBounds = {
      availableWidth: Math.max(320, bounds.width || center?.width || 720),
      availableHeight: Math.max(480, bounds.height || center?.height || 720),
      fitFraction: .88,
      maxScale: 1.2
    };

    if (stage === 'final' && previewCompare) {
      const profiles = model.targetProfiles.slice(0, 4);
      renderDeviceComparison(host, profiles.map(device => ({
        frame,
        device,
        orientation: previewOrientation,
        assetUrl,
        textScale: 1,
        panelStyle: 'glass',
        fitBounds: { ...fitBounds, fitFraction: .62, maxScale: .72 },
        showSafeArea: previewShowSafeArea
      })));
    } else {
      const device = deviceProfileService.resolve(previewDeviceId) || deviceProfileService.defaultProfile();
      renderPlayerFrame(host, {
        frame,
        device,
        orientation: previewOrientation,
        assetUrl,
        textScale: 1,
        panelStyle: 'glass',
        fitBounds,
        showSafeArea: previewShowSafeArea,
        showFocalPoint: stage === 'visual' && unit.visualReady,
        onFocalPointChange: stage === 'visual' && unit.visualReady
          ? (point, meta) => { if (meta.commit) updateVisual({ focalPoint: point, status: unit.assignment?.status === 'approved' ? 'needs-review' : (unit.assignment?.status || 'draft') }).catch(error => toast(error.message || error, 'error')); }
          : null,
        onZoomChange: stage === 'visual' && unit.visualReady
          ? (zoom, meta) => { if (meta.commit) updateVisual({ zoom, status: unit.assignment?.status === 'approved' ? 'needs-review' : (unit.assignment?.status || 'draft') }).catch(error => toast(error.message || error, 'error')); }
          : null
      });
    }

    if (!host.querySelector('.player-device')) throw new Error('Renderer не создал устройство Preview');
    host.dataset.renderState = unit.assetId ? 'ready' : 'placeholder';
  } catch (error) {
    console.error('[HEARTLINE:editorial-preview]', error);
    if (generation === previewRenderGeneration) {
      host.dataset.renderState = 'error';
      renderPreviewFailure(host, error);
    }
  }
}

async function move(delta, { mark = false } = {}) {
  let current = currentUnit();
  if (!current) return;
  if (stage === 'text') {
    await flushPendingText();
    current = currentUnit() || current;
  } else if (stage === 'final') {
    await flushPendingFinalText();
    current = currentUnit() || current;
  }
  if (mark && stage === 'text') {
    try { await workflowService.markText(model.project.projectId, current.fragmentId); }
    catch (error) { toast(error.message || error, 'warning'); }
  } else if (mark && stage === 'final') {
    const result = await workflowService.completeFinal(model.project.projectId, current.fragmentId);
    if (!result.completed) toast(result.blockers?.[0]?.text || 'Кадр требует внимания', 'warning');
    else toast('Кадр прошёл финальную проверку', 'success');
  }
  model = await workflowService.load(model.project.projectId);
  const index = Math.max(0, model.units.findIndex(unit => unit.fragmentId === current.fragmentId));
  const target = model.units[index + delta];
  if (!target) {
    selectedFragmentId = current.fragmentId;
    renderWorkspace();
    return;
  }
  await selectUnit(target.fragmentId);
}

function bindWorkspace() {
  document.querySelectorAll('[data-editorial-stage]').forEach(button => {
    button.onclick = () => changeStage(button.dataset.editorialStage);
  });
  document.querySelectorAll('[data-editorial-unit]').forEach(button => {
    button.onclick = () => selectUnit(button.dataset.editorialUnit);
  });

  const editor = $('hlEditorialTextEditor');
  if (editor) editor.oninput = scheduleTextSave;

  $('hlEditorialAddReview')?.addEventListener('click', () => { reviewFormOpen = true; renderWorkspace(); });
  $('hlEditorialFinalReview')?.addEventListener('click', () => { reviewFormOpen = true; renderWorkspace(); });
  $('hlEditorialCancelReview')?.addEventListener('click', () => { reviewFormOpen = false; renderWorkspace(); });
  $('hlEditorialSaveReview')?.addEventListener('click', () => saveReview().catch(error => toast(error.message || error, 'error')));
  document.querySelectorAll('[data-editorial-review-status]').forEach(select => {
    select.onchange = async () => {
      await workflowService.updateReviewWorkflow(select.dataset.editorialReviewStatus, select.value);
      await reload();
    };
  });

  const visualInput = $('hlEditorialVisualInput');
  $('hlEditorialUploadVisual')?.addEventListener('click', () => visualInput?.click());
  if (visualInput) visualInput.onchange = () => uploadVisual(visualInput.files?.[0]).catch(error => toast(error.message || error, 'error'));
  $('hlEditorialAssignExisting')?.addEventListener('click', () => {
    const assetId = $('hlEditorialExistingAsset')?.value;
    if (!assetId) return toast('Выберите изображение из библиотеки', 'warning');
    workflowService.assignExistingVisual(model.project.projectId, currentUnit().fragmentId, assetId)
      .then(() => reload())
      .catch(error => toast(error.message || error, 'error'));
  });

  const zoom = $('hlEditorialZoom');
  if (zoom) zoom.onchange = () => updateVisual({
    zoom: Number(zoom.value),
    status: currentUnit().assignment?.status === 'approved' ? 'needs-review' : (currentUnit().assignment?.status || 'draft')
  }).catch(error => toast(error.message || error, 'error'));
  const overlay = $('hlEditorialOverlay');
  if (overlay) overlay.onchange = () => updateVisual({
    overlayOpacity: Number(overlay.value),
    status: currentUnit().assignment?.status === 'approved' ? 'needs-review' : (currentUnit().assignment?.status || 'draft')
  }).catch(error => toast(error.message || error, 'error'));

  $('hlEditorialEditFinalText')?.addEventListener('click', () => {
    if (finalEditOpen) closeFinalEditor();
    else openFinalEditor();
  });
  $('hlEditorialEditCaption')?.addEventListener('click', openFinalEditor);
  $('hlEditorialCancelFinalText')?.addEventListener('click', closeFinalEditor);
  $('hlEditorialSaveFinalText')?.addEventListener('click', () => {
    saveFinalText($('hlEditorialFinalEditor').value)
      .catch(error => toast(error.message || error, 'error'));
  });
  $('hlEditorialFinalEditor')?.addEventListener('input', scheduleFinalTextDraftSave);
  $('hlEditorialFinalEditor')?.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      $('hlEditorialSaveFinalText')?.click();
    }
    if (event.key === 'Escape') closeFinalEditor();
  });

  const device = $('hlEditorialDevice');
  if (device) {
    device.value = previewDeviceId;
    device.onchange = () => { previewDeviceId = device.value; renderPreview().catch(() => {}); };
  }
  const orientation = $('hlEditorialOrientation');
  if (orientation) {
    orientation.value = previewOrientation;
    orientation.onchange = () => { previewOrientation = orientation.value; renderPreview().catch(() => {}); };
  }
  const safe = $('hlEditorialSafeArea');
  if (safe) safe.onchange = () => { previewShowSafeArea = safe.checked; renderPreview().catch(() => {}); };
  $('hlEditorialCompare')?.addEventListener('click', () => { previewCompare = !previewCompare; renderWorkspace(); });

  $('hlEditorialFirst')?.addEventListener('click', () => model.units[0] && selectUnit(model.units[0].fragmentId));
  $('hlEditorialLast')?.addEventListener('click', () => model.units.at(-1) && selectUnit(model.units.at(-1).fragmentId));
  $('hlEditorialPrev')?.addEventListener('click', () => move(-1));
  $('hlEditorialNext')?.addEventListener('click', () => move(1, { mark: true }));
}

function makeNav(id) {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = 'nav-button hl-editorial-nav';
  button.textContent = 'Вычитка';
  button.onclick = () => open();
  return button;
}

function installNavigation() {
  const desktop = $('mainNav');
  const legacyReader = desktop?.querySelector('[data-route="reader"]');
  if (legacyReader) { legacyReader.hidden = true; legacyReader.style.display = 'none'; }
  if (desktop && !$('hlEditorialNav')) desktop.insertBefore(makeNav('hlEditorialNav'), legacyReader || desktop.children[1] || null);

  const mobile = document.querySelector('.mobile-nav');
  const mobileReader = mobile?.querySelector('[data-route="reader"]');
  if (mobileReader) { mobileReader.hidden = true; mobileReader.style.display = 'none'; }
  if (mobile && !$('hlEditorialMobileNav')) mobile.insertBefore(makeNav('hlEditorialMobileNav'), mobileReader || mobile.children[1] || null);

  document.querySelectorAll('[data-route],#brandButton').forEach(button => {
    if (button.dataset.hlEditorialLeaveBound) return;
    button.dataset.hlEditorialLeaveBound = '1';
    button.addEventListener('click', () => {
      if (!button.classList.contains('hl-editorial-nav')) leave();
    }, true);
  });
}

function recommendedStageForModel(nextModel) {
  const persisted = nextModel?.editorialState?.activeStage;
  if (persisted && stageInfoFrom(nextModel, persisted).percent < 100) return persisted;
  return nextModel?.recommendedStage || 'text';
}

function stageInfoFrom(nextModel, name) {
  return nextModel?.stages?.[name] || { percent: 0 };
}

export async function open({ stage: requestedStage = null, fragmentId = null } = {}) {
  active = true;
  installStyles();
  installNavigation();
  document.querySelectorAll('[data-route]').forEach(button => button.classList.remove('active'));
  document.querySelectorAll('.hl-editorial-nav').forEach(button => button.classList.add('active'));

  const projectId = await workflowService.getActiveProjectId();
  const view = $('view');
  if (!projectId) {
    view.className = 'view';
    view.innerHTML = '<section class="page"><div class="empty-state"><div><h2>Сначала откройте проект</h2><p>Редакторский процесс доступен после выбора новеллы.</p></div></div></section>';
    return;
  }

  model = await workflowService.load(projectId);
  stage = requestedStage && ['text', 'visual', 'final'].includes(requestedStage)
    ? requestedStage
    : recommendedStageForModel(model);
  selectedFragmentId = fragmentId && model.units.some(unit => unit.fragmentId === fragmentId)
    ? fragmentId
    : model.workspace.selectedFragmentId || model.units[0]?.fragmentId || null;
  if (selectedFragmentId) await workflowService.setSelection(projectId, currentUnit());
  await workflowService.setActiveStage(projectId, stage);
  renderWorkspace();
}

export function leave() {
  if (!active) return;
  const pendingFinalEditor = $('hlEditorialFinalEditor');
  const pendingFinalUnit = currentUnit();
  if (stage === 'final' && finalEditOpen && pendingFinalEditor && pendingFinalUnit && pendingFinalEditor.value !== pendingFinalUnit.text) {
    clearTimeout(editorTimer);
    workflowService.saveText(model.project.projectId, pendingFinalUnit.fragmentId, pendingFinalEditor.value, 'editorial-final-leave')
      .catch(error => console.error('[HEARTLINE:editorial-final-leave]', error));
  }
  active = false;
  clearTimeout(editorTimer);
  document.body.classList.remove('hl-editorial-active', 'hl-proofreading-active');
  document.querySelectorAll('.hl-editorial-nav').forEach(button => button.classList.remove('active'));
}

async function openProjectAtStage(projectId, targetStage) {
  const card = [...document.querySelectorAll('[data-project-card]')].find(item => item.dataset.projectCard === projectId);
  card?.querySelector('[data-open-project]')?.click();
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 80));
    if (await workflowService.getActiveProjectId() === projectId) break;
  }
  await open({ stage: targetStage });
}

async function enhanceLibrary() {
  const page = document.querySelector('.library-page');
  if (!page) return;
  const cards = [...page.querySelectorAll('[data-project-card]')];
  for (const card of cards) {
    try {
      const nextModel = await workflowService.load(card.dataset.projectCard);
      const panel = card.querySelector('.hl-project-proofreading');
      if (!panel || !card.isConnected) continue;
      panel.classList.add('hl-project-pipeline');
      panel.innerHTML = `<div class="hl-project-pipeline-head"><span>Готовность проекта</span><strong>${nextModel.stages.final.percent === 100 ? 'Готово' : 'В работе'}</strong></div>
        <div class="hl-project-pipeline-stage"><span>Вычитка</span><b>${nextModel.stages.text.percent}%</b><i><em style="width:${nextModel.stages.text.percent}%"></em></i></div>
        <div class="hl-project-pipeline-stage"><span>Визуалы</span><b>${nextModel.stages.visual.percent}%</b><i><em style="width:${nextModel.stages.visual.percent}%"></em></i></div>
        <div class="hl-project-pipeline-stage"><span>Финальная проверка</span><b>${nextModel.stages.final.percent}%</b><i><em style="width:${nextModel.stages.final.percent}%"></em></i></div>
        <div class="hl-project-pipeline-meta"><span>${nextModel.stages.final.attention} требуют внимания</span><span>${nextModel.stages.final.changed} изменено после финала</span></div>`;
    } catch (_) {}
  }

  const callout = page.querySelector('.hl-library-next-action');
  const first = cards[0];
  if (callout && first) {
    try {
      const nextModel = await workflowService.load(first.dataset.projectCard);
      const nextStage = nextModel.recommendedStage;
      const title = nextStage === 'text' ? 'Продолжить вычитку' : nextStage === 'visual' ? 'Продолжить визуалы' : nextModel.stages.final.percent === 100 ? 'Проект готов' : 'Продолжить финальную проверку';
      const body = callout.querySelector('.hl-action-callout-body');
      const headline = callout.querySelector('.hl-action-callout-title');
      const action = callout.querySelector('.hl-action-callout-button.primary');
      if (headline) headline.textContent = title;
      if (body) body.textContent = `${first.querySelector('h2')?.textContent?.trim() || 'Проект'} · текст ${nextModel.stages.text.percent}% · визуалы ${nextModel.stages.visual.percent}% · финал ${nextModel.stages.final.percent}%.`;
      if (action) {
        action.textContent = nextModel.stages.final.percent === 100 ? 'Открыть проект' : 'Продолжить →';
        action.onclick = () => openProjectAtStage(first.dataset.projectCard, nextStage);
      }
    } catch (_) {}
  }
}

export function enhance() {
  installNavigation();
  requestAnimationFrame(() => requestAnimationFrame(() => enhanceLibrary().catch(() => {})));
}

installStyles();
installNavigation();

window.addEventListener('resize', () => {
  if (active && stage !== 'text') renderPreview().catch(() => {});
});

const api = Object.freeze({
  open,
  leave,
  enhance,
  enhanceLibrary,
  get service() { return workflowService; },
  get proofreadingService() { return proofreadingService; }
});

window.HEARTLINEEditorialWorkspace = api;
// Compatibility alias used by Library/DesignSystem and older deep links.
window.HEARTLINEProofreading = api;
