const STYLE_ID = 'hlDesignSystemStyles';
let scheduled = false;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./design-system.css', import.meta.url).href;
  document.head.appendChild(link);
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function createActionCallout({ tone = 'info', eyebrow = '', title, body = '', actionLabel = '', onAction = null, secondaryLabel = '', onSecondary = null }) {
  const node = document.createElement('section');
  node.className = 'hl-action-callout';
  node.dataset.tone = tone;
  node.innerHTML = `<div class="hl-action-callout-copy">${eyebrow ? `<span class="hl-action-callout-eyebrow"></span>` : ''}<strong class="hl-action-callout-title"></strong>${body ? '<p class="hl-action-callout-body"></p>' : ''}</div><div class="hl-action-callout-actions"></div>`;
  if (eyebrow) node.querySelector('.hl-action-callout-eyebrow').textContent = eyebrow;
  node.querySelector('.hl-action-callout-title').textContent = title;
  if (body) node.querySelector('.hl-action-callout-body').textContent = body;
  const actions = node.querySelector('.hl-action-callout-actions');
  if (secondaryLabel && onSecondary) {
    const secondary = document.createElement('button');
    secondary.type = 'button';
    secondary.className = 'hl-action-callout-button secondary';
    secondary.textContent = secondaryLabel;
    secondary.onclick = onSecondary;
    actions.appendChild(secondary);
  }
  if (actionLabel && onAction) {
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'hl-action-callout-button primary';
    primary.textContent = actionLabel;
    primary.onclick = onAction;
    actions.appendChild(primary);
  }
  return node;
}

function createDisclosure(label, className = '') {
  const details = document.createElement('details');
  details.className = `hl-ds-disclosure ${className}`.trim();
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'hl-ds-disclosure-body';
  details.appendChild(body);
  return { details, body };
}

function firstProjectCard() {
  return document.querySelector('.library-page [data-project-card]');
}

async function openProjectInProofreading(projectId) {
  const card = [...document.querySelectorAll('[data-project-card]')].find(item => item.dataset.projectCard === projectId);
  const openButton = card?.querySelector('[data-open-project]');
  if (!openButton) return;
  openButton.click();
  const service = window.HEARTLINEProofreading?.service;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(90);
    try {
      const activeId = await service?.getActiveProjectId?.();
      if (activeId === projectId) {
        await window.HEARTLINEProofreading?.open?.();
        return;
      }
    } catch (_) {}
  }
  await window.HEARTLINEProofreading?.open?.();
}

async function enhanceLibrary() {
  const page = document.querySelector('.library-page');
  if (!page || page.dataset.hlDsPending === '1' || page.dataset.hlDsEnhanced === '1') return;
  page.dataset.hlDsPending = '1';
  page.querySelector('.page-header .kicker')?.replaceChildren(document.createTextNode('HEARTLINE'));
  const headerCopy = page.querySelector('.page-header p');
  if (headerCopy) headerCopy.textContent = 'Продолжайте вычитку, управляйте проектами и открывайте дополнительные инструменты только когда они нужны.';
  page.querySelector('.library-sync-note')?.classList.add('hl-inline-notice');
  page.querySelectorAll('.page-header .header-actions .button.primary').forEach(button => {
    button.classList.remove('primary');
    button.classList.add('secondary');
  });

  const cards = [...page.querySelectorAll('[data-project-card]')];
  for (const card of cards) {
    if (card.dataset.hlDsCard === '1') continue;
    card.dataset.hlDsCard = '1';
    const stats = card.querySelector('.project-stats-grid');
    if (stats) {
      const { details, body } = createDisclosure('Структура и статистика', 'hl-project-details');
      stats.parentElement.insertBefore(details, stats);
      body.appendChild(stats);
    }
    const open = card.querySelector('[data-open-project]');
    if (open) {
      open.classList.remove('primary');
      open.classList.add('secondary');
      open.textContent = 'Открыть';
    }
    const footerCopy = card.querySelector('.project-card-rich-foot .muted');
    if (footerCopy) footerCopy.textContent = 'Последняя рабочая позиция сохранена';
  }

  const card = firstProjectCard();
  if (card && !page.querySelector('.hl-library-next-action')) {
    const projectId = card.dataset.projectCard;
    const projectTitle = card.querySelector('h2')?.textContent?.trim() || 'Проект';
    let title = 'Продолжить вычитку';
    let body = `${projectTitle} — открыть последнюю рабочую позицию.`;
    let tone = 'info';
    try {
      const model = await window.HEARTLINEProofreading?.service?.load?.(projectId);
      if (!page.isConnected) return;
      if (model?.progress) {
        const selected = model.units?.find(unit => unit.fragmentId === model.workspace?.selectedFragmentId) || model.units?.[0];
        const location = selected ? `${selected.chapterTitle} · ${selected.sceneTitle}` : 'последняя позиция';
        const openIssues = Number(model.progress.counts?.attention || 0);
        const changed = Number(model.progress.counts?.changed || 0);
        body = `${projectTitle}: ${model.progress.percent}% вычитано · ${location}${openIssues ? ` · ${openIssues} с замечаниями` : ''}${changed ? ` · ${changed} изменено после вычитки` : ''}.`;
        if (model.progress.percent === 100 && !openIssues && !changed) {
          title = 'Вычитка завершена';
          body = `${projectTitle} полностью пройдена. Можно открыть проект для финальной проверки или экспорта.`;
          tone = 'success';
        }
      }
    } catch (_) {}
    const callout = createActionCallout({
      tone,
      eyebrow: 'Следующее действие',
      title,
      body,
      actionLabel: title === 'Вычитка завершена' ? 'Открыть проект' : 'Продолжить →',
      onAction: () => openProjectInProofreading(projectId)
    });
    callout.classList.add('hl-library-next-action');
    const toolbar = page.querySelector('.library-toolbar');
    page.insertBefore(callout, toolbar || page.querySelector('.project-list'));
  }
  page.dataset.hlDsPending = '0';
  page.dataset.hlDsEnhanced = '1';
}

function enhanceStoryboard() {
  const grid = document.querySelector('.storyboard-grid');
  if (!grid) return;
  const page = grid.closest('.page');
  if (!page || page.dataset.hlDsStoryboard === '1') return;
  page.dataset.hlDsStoryboard = '1';
  const cards = [...grid.querySelectorAll('.frame-card')];
  cards.forEach(card => {
    card.tabIndex = 0;
    card.classList.add('hl-ds-hover-card');
  });
  const missing = cards.filter(card => card.querySelector('.status-badge.missing')).length;
  const needsReview = cards.filter(card => card.querySelector('.status-badge.needs-review')).length;
  const nextMissing = page.querySelector('#nextMissing');
  if (nextMissing) nextMissing.classList.add('hl-ds-original-action');
  if (!page.querySelector('.hl-storyboard-next-action') && (missing || needsReview)) {
    const title = missing ? 'Есть кадры без изображения' : 'Есть визуалы для повторной проверки';
    const body = missing ? `На текущей сцене показано ${missing} кадров без изображения. Начните с ближайшего проблемного кадра.` : `${needsReview} визуалов требуют проверки перед финальной сборкой.`;
    const callout = createActionCallout({
      tone: missing ? 'warning' : 'info',
      eyebrow: 'Следующее действие',
      title,
      body,
      actionLabel: missing && nextMissing ? 'Следующий проблемный кадр →' : '',
      onAction: missing && nextMissing ? () => nextMissing.click() : null
    });
    callout.classList.add('hl-storyboard-next-action');
    const toolbar = page.querySelector('.storyboard-toolbar');
    page.insertBefore(callout, toolbar || grid);
  }
}

function enhanceGraph() {
  const toolbar = document.querySelector('.graph21-toolbar');
  if (!toolbar || toolbar.dataset.hlDsGraph === '1') return;
  toolbar.dataset.hlDsGraph = '1';
  const search = toolbar.querySelector('#graphSearch');
  const zoom = toolbar.querySelector('.graph21-zoom');
  const { details, body } = createDisclosure('Настройки вида', 'hl-graph-settings');
  const movable = [...toolbar.children].filter(node => node !== search && node !== zoom);
  movable.forEach(node => body.appendChild(node));
  if (zoom) toolbar.insertBefore(details, zoom); else toolbar.appendChild(details);
  const graphReader = document.querySelector('#graphReader');
  if (graphReader) graphReader.textContent = 'Открыть в вычитке';
  document.querySelector('.graph21-integrity')?.classList.add('hl-inline-notice');
}

function enhanceReviews() {
  const list = document.querySelector('.grouped-review-list');
  if (!list) return;
  const page = list.closest('.page');
  if (!page || page.dataset.hlDsReviews === '1') return;
  page.dataset.hlDsReviews = '1';
  const bulk = page.querySelector('.bulk-review-bar');
  if (bulk) {
    const { details, body } = createDisclosure('Массовые действия', 'hl-review-bulk');
    bulk.parentElement.insertBefore(details, bulk);
    body.appendChild(bulk);
  }
  const gpt = page.querySelector('#gptFromReviews');
  if (gpt) {
    gpt.classList.remove('primary');
    gpt.classList.add('secondary');
  }
  const firstJump = page.querySelector('[data-review-jump]');
  const count = page.querySelectorAll('.review-queue-card').length;
  if (firstJump && !page.querySelector('.hl-review-next-action')) {
    const callout = createActionCallout({
      tone: 'info',
      eyebrow: 'Следующее действие',
      title: 'Следующее нерешённое замечание',
      body: `В очереди ${count} замечаний. Откройте первое и обработайте очередь последовательно.`,
      actionLabel: 'Открыть замечание →',
      onAction: () => firstJump.click()
    });
    callout.classList.add('hl-review-next-action');
    const toolbar = page.querySelector('.review-toolbar');
    page.insertBefore(callout, toolbar || list);
  }
}

function enhanceExport() {
  const grid = document.querySelector('.export-grid');
  if (!grid) return;
  const page = grid.closest('.page');
  if (!page) return;
  const firstPass = page.dataset.hlDsExport !== '1';
  if (firstPass) page.dataset.hlDsExport = '1';
  const heading = page.querySelector('.page-header h1');
  if (heading) heading.textContent = 'Экспортировать проект';
  const intro = page.querySelector('.page-header p');
  if (intro) intro.textContent = 'Выберите нужный формат. Дополнительные отчёты и техническая информация скрыты ниже.';

  const preflight = page.querySelector('.preflight-card');
  if (firstPass) {
  const metricGrid = page.querySelector('.metric-grid');
  if (preflight) {
    preflight.classList.add('hl-action-callout', preflight.classList.contains('ready') ? 'hl-callout-success' : 'hl-callout-warning');
    if (metricGrid) page.insertBefore(preflight, metricGrid);
  }
  if (metricGrid) {
    const { details, body } = createDisclosure('Технические метрики проекта', 'hl-export-metrics');
    metricGrid.parentElement.insertBefore(details, metricGrid);
    body.appendChild(metricGrid);
  }

  const cards = [...grid.querySelectorAll('.export-card')];
  const extra = cards.filter(card => ['Отчёты', 'Локальное хранилище'].includes(card.querySelector('h2')?.textContent?.trim()));
  if (extra.length) {
    const { details, body } = createDisclosure('Дополнительно', 'hl-export-extra');
    grid.parentElement.insertBefore(details, grid.nextSibling);
    const extraGrid = document.createElement('div');
    extraGrid.className = 'export-grid hl-export-extra-grid';
    body.appendChild(extraGrid);
    extra.forEach(card => extraGrid.appendChild(card));
  }

  }

  const backup = page.querySelector('#hlCreateBackup');
  if (backup && preflight) {
    const sourceCard = backup.closest('.export-card');
    sourceCard?.classList.add('hl-ds-source-card-hidden');
    if (!preflight.querySelector('.hl-ds-source-meta')) {
      const meta = document.createElement('div');
      meta.className = 'hl-ds-source-meta';
      meta.innerHTML = '<span>Исходный проект подключён</span><small>Hash conflict protection, recovery и backup активны.</small>';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary small';
      button.textContent = 'Создать backup';
      button.onclick = () => backup.click();
      meta.appendChild(button);
      preflight.appendChild(meta);
    }
  }
  page.querySelectorAll('.export-card').forEach(card => card.classList.add('hl-ds-export-card'));
}

function enhanceVersions() {
  const list = document.querySelector('.version-list');
  if (!list) return;
  const page = list.closest('.page');
  if (!page || page.dataset.hlDsVersions === '1') return;
  page.dataset.hlDsVersions = '1';
  const heading = page.querySelector('.page-header h1');
  if (heading) heading.textContent = 'История редакций';
  const intro = page.querySelector('.page-header p');
  if (intro) intro.textContent = 'Контрольные точки помогают сравнивать изменения и безопасно возвращаться к предыдущему состоянию.';
  page.querySelectorAll('.version-card .muted').forEach(node => {
    const text = node.textContent || '';
    if (text.includes(' · parent:')) node.textContent = text.split(' · parent:')[0];
  });
  const original = page.querySelector('#createVersion');
  if (original) {
    original.classList.add('hl-ds-original-action');
    const callout = createActionCallout({
      tone: 'info',
      eyebrow: 'Контрольная точка',
      title: 'Зафиксировать текущую редакцию',
      body: 'Создайте revision перед крупной переработкой или экспериментом. Для source-backed проекта это остаётся внутри того же projectId.',
      actionLabel: 'Создать revision',
      onAction: () => original.click()
    });
    page.insertBefore(callout, list);
  }
}

function enhanceProofreading() {
  const shell = document.querySelector('.hl-proofreading-shell');
  if (!shell) return;
  const meta = shell.querySelector('.hl-proof-editor-head p');
  if (meta && meta.dataset.hlDsClean !== '1') {
    const parts = meta.textContent.split(' · ');
    if (parts.length > 1) parts.pop();
    meta.textContent = parts.join(' · ');
    meta.dataset.hlDsClean = '1';
  }
  const rightBody = shell.querySelector('#hlProofRightBody');
  const rightTitle = shell.querySelector('#hlProofRightTitle')?.textContent?.trim();
  if (!rightBody || rightTitle !== 'Замечания' || rightBody.dataset.hlDsProof === '1') return;
  rightBody.dataset.hlDsProof = '1';
  if (rightBody.querySelector('.hl-proof-review-card')) return;
  const add = rightBody.querySelector('#hlProofAddReview');
  if (!add) return;
  add.classList.add('hl-ds-callout-replaced');
  rightBody.querySelector('.hl-proof-empty')?.classList.add('hl-ds-empty-replaced');
  const callout = createActionCallout({
    tone: 'info',
    eyebrow: 'Замечание к тексту',
    title: 'Есть проблема с фрагментом?',
    body: 'Выделите конкретный текст перед созданием замечания — так оно останется устойчиво привязано к нужному месту.',
    actionLabel: '+ Добавить замечание',
    onAction: () => add.click()
  });
  callout.classList.add('hl-proof-review-onboarding');
  rightBody.prepend(callout);
}

function enhanceTopbar() {
  const brandSub = document.querySelector('.brand small');
  if (brandSub && brandSub.textContent !== 'Novel Editor') brandSub.textContent = 'Novel Editor';
  const install = document.querySelector('#installButton');
  if (install) install.classList.add('hl-ds-install-action');
  const editable = Boolean(document.querySelector('.hl-proofreading-shell,.reader-layout,.storyboard-grid,.preview-layout'));
  document.querySelector('#undoButton')?.classList.toggle('hl-ds-context-hidden', !editable);
  document.querySelector('#redoButton')?.classList.toggle('hl-ds-context-hidden', !editable);
}

async function enhanceCurrentView() {
  scheduled = false;
  enhanceTopbar();
  enhanceProofreading();
  enhanceStoryboard();
  enhanceGraph();
  enhanceReviews();
  enhanceExport();
  enhanceVersions();
  await enhanceLibrary();
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { enhanceCurrentView().catch(error => console.warn('[HEARTLINE:design-system]', error)); });
}

installStyles();
const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
document.addEventListener('click', scheduleEnhance, true);
scheduleEnhance();

window.HEARTLINEDesignSystem = Object.freeze({ enhance: scheduleEnhance, version: '1.0.0' });
