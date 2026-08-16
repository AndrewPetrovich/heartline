let scheduled = false;

function enhance() {
  scheduled = false;
  window.HEARTLINEProjectBridge?.enhance?.();
  window.HEARTLINEProofreading?.enhance?.();
  window.HEARTLINEDesignSystem?.enhance?.();
  window.HEARTLINEFontPolicy?.apply?.();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(enhance);
}

const view = document.getElementById('view');
const observer = new MutationObserver(schedule);
if (view) observer.observe(view, { childList: true });

document.addEventListener('click', schedule, true);
window.addEventListener('heartline:db-write', schedule);

schedule();
window.HEARTLINEPresentationCoordinator = Object.freeze({ schedule, version: '1.0.0' });
