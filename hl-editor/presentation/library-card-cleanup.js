const STYLE_ID = 'hlLibraryCardCleanupStyles';
let scheduled = false;

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

function cleanLibraryCards() {
  document.querySelectorAll('.library-page [data-project-card]').forEach(card => {
    cleanCover(card);
    removeStructureAndProduction(card);
  });
}

function scheduleCleanup() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    cleanLibraryCards();
  });
}

installStyles();
cleanLibraryCards();

const observer = new MutationObserver(scheduleCleanup);
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('click', scheduleCleanup, true);

window.HEARTLINELibraryCardCleanup = Object.freeze({
  clean: scheduleCleanup,
  version: '1.0.0'
});
