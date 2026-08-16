const STYLE_ID = 'hlLibraryCardCleanupStyles';
let scheduled = false;
let cleaning = false;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./library-card-cleanup.css', import.meta.url).href;
  document.head.appendChild(link);
}

function cleanCover(card) {
  const placeholder = card.querySelector('.project-cover-placeholder');
  if (!placeholder) return;
  placeholder.querySelectorAll(':scope > span, :scope > strong').forEach(node => node.remove());
  placeholder.setAttribute('aria-hidden', 'true');
}

function removeStructureAndProduction(card) {
  card.querySelectorAll('.hl-project-details').forEach(node => node.remove());
  card.querySelectorAll('.project-stats-grid').forEach(node => node.remove());
  card.querySelectorAll('.project-production-row').forEach(node => node.remove());
}

function presentationFromModel(model) {
  const progress = model?.progress || { total: 0, completed: 0, percent: 0, counts: {} };
  const openReviews = (model?.units || []).reduce((sum, unit) => sum + Number(unit.openReviewCount || 0), 0);
  const changed = Number(progress.counts?.changed || 0);
  const attention = Number(progress.counts?.attention || 0);
  const total = Number(progress.total || 0);
  const completed = Number(progress.completed || 0);
  const percent = Number(progress.percent || 0);
  const remaining = Math.max(0, total - completed);

  let status = 'not-started';
  let label = 'Вычитка не начата';
  if (attention || changed || openReviews) {
    status = 'attention';
    label = 'Требует внимания';
  } else if (total && percent === 100) {
    status = 'reviewed';
    label = 'Вычитано';
  } else if (completed || percent > 0) {
    status = 'in-progress';
    label = 'Вычитка в работе';
  }

  const selected = (model?.units || []).find(unit => unit.fragmentId === model?.workspace?.selectedFragmentId)
    || (model?.units || []).find(unit => !['reviewed', 'approved'].includes(unit.status))
    || model?.units?.[0]
    || null;

  return {
    status,
    label,
    percent,
    completed,
    total,
    remaining,
    openReviews,
    changed,
    location: selected ? `${selected.chapterTitle} · ${selected.sceneTitle}` : 'Позиция не выбрана'
  };
}

function createReadinessPanel(model) {
  const info = presentationFromModel(model);
  const node = document.createElement('section');
  node.className = 'hl-project-proofreading';
  node.dataset.status = info.status;
  node.dataset.percent = String(info.percent);
  node.dataset.openReviews = String(info.openReviews);
  node.dataset.changed = String(info.changed);
  node.innerHTML = `
    <div class="hl-project-proofreading-head">
      <div>
        <span>Готовность вычитки</span>
        <strong></strong>
      </div>
      <b class="hl-project-proofreading-percent"></b>
    </div>
    <div class="hl-project-proofreading-progress" aria-hidden="true"><i></i></div>
    <p class="hl-project-proofreading-completion"></p>
    <div class="hl-project-proofreading-metrics">
      <div><strong></strong><span>осталось</span></div>
      <div><strong></strong><span>замечаний</span></div>
      <div><strong></strong><span>изменено</span></div>
    </div>
    <div class="hl-project-proofreading-location">
      <span>Последняя позиция</span>
      <strong></strong>
    </div>`;

  node.querySelector('.hl-project-proofreading-head strong').textContent = info.label;
  node.querySelector('.hl-project-proofreading-percent').textContent = `${info.percent}%`;
  node.querySelector('.hl-project-proofreading-progress i').style.width = `${Math.max(0, Math.min(100, info.percent))}%`;
  node.querySelector('.hl-project-proofreading-completion').textContent = info.total
    ? `${info.completed} из ${info.total} фрагментов проверено`
    : 'В проекте нет доступных текстовых фрагментов';

  const metricValues = node.querySelectorAll('.hl-project-proofreading-metrics strong');
  metricValues[0].textContent = String(info.remaining);
  metricValues[1].textContent = String(info.openReviews);
  metricValues[2].textContent = String(info.changed);

  node.querySelector('.hl-project-proofreading-location strong').textContent = info.location;
  return node;
}

async function ensureReadiness(card) {
  if (card.querySelector('.hl-project-proofreading')) return;
  if (card.dataset.hlReadinessPending === '1') return;

  const projectId = card.dataset.projectCard;
  const service = window.HEARTLINEProofreading?.service;
  if (!projectId || !service?.load) return;

  card.dataset.hlReadinessPending = '1';
  try {
    const model = await service.load(projectId);
    if (!card.isConnected || card.querySelector('.hl-project-proofreading')) return;

    const panel = createReadinessPanel(model);
    const footer = card.querySelector('.project-card-rich-foot');
    if (footer?.parentElement) footer.parentElement.insertBefore(panel, footer);
  } catch (_) {
    /* Keep the Library usable even if one project's review model is unavailable. */
  } finally {
    delete card.dataset.hlReadinessPending;
  }
}

async function cleanLibraryCards() {
  if (cleaning) return;
  cleaning = true;
  try {
    const cards = [...document.querySelectorAll('.library-page [data-project-card]')];
    for (const card of cards) {
      cleanCover(card);
      removeStructureAndProduction(card);
      await ensureReadiness(card);
    }
  } finally {
    cleaning = false;
  }
}

function scheduleCleanup() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    cleanLibraryCards().catch(() => {});
  });
}

installStyles();
scheduleCleanup();

const observer = new MutationObserver(scheduleCleanup);
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('click', scheduleCleanup, true);

window.HEARTLINELibraryCardCleanup = Object.freeze({
  clean: scheduleCleanup,
  version: '1.1.0'
});
