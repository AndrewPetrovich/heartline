// HEARTLINE 3.1.1 — robust grouped navigation behavior
const groups = () => [...document.querySelectorAll('.desktop-nav .nav-group')];

function closeDesktopNavGroups(except = null) {
  for (const group of groups()) {
    if (group !== except) group.removeAttribute('open');
  }
}

function wireGroupedNavigation() {
  for (const group of groups()) {
    const summary = group.querySelector(':scope > summary');
    if (summary && !summary.dataset.navFixWired) {
      summary.dataset.navFixWired = '1';
      summary.addEventListener('click', () => {
        // Native <details> toggles after the click. We only close siblings.
        closeDesktopNavGroups(group);
      });
    }

    for (const button of group.querySelectorAll('[data-route]')) {
      if (button.dataset.navFixWired) continue;
      button.dataset.navFixWired = '1';
      button.addEventListener('click', () => {
        // The HEARTLINE app owns route switching. Close the popup only after
        // its click handlers have received the same event.
        setTimeout(() => closeDesktopNavGroups(), 0);
      });
    }
  }
}

document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.desktop-nav .nav-group')) closeDesktopNavGroups();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeDesktopNavGroups();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireGroupedNavigation, { once: true });
} else {
  wireGroupedNavigation();
}
