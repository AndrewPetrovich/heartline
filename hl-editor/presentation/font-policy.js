const STYLE_ID = 'hlUnifiedFontPolicy';
const PREFS_KEY = 'heartline-reader-prefs-v1';

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./font-policy.css', import.meta.url).href;
  document.head.appendChild(link);
}

function normalizeReaderPreference() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (value.font === 'sans') return;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...value, font: 'sans' }));
  } catch (_) {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ font: 'sans' }));
  }
}

function removeLegacyFontControl(root = document) {
  if (!root?.querySelector) return;
  const selector = root.querySelector('#hlProofFont');
  const label = selector?.closest('label');
  if (label) label.remove();

  document.querySelector('.hl-proofreading-shell')?.classList.add('hl-proof-font-sans');
}

function inspectAddedNode(node) {
  if (!(node instanceof Element)) return;
  removeLegacyFontControl(node);
  if (node.matches?.('#hlProofFont')) node.closest('label')?.remove();
}

installStyle();
normalizeReaderPreference();
removeLegacyFontControl();

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) inspectAddedNode(node);
  }
  removeLegacyFontControl();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.HEARTLINEFontPolicy = Object.freeze({
  family: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  version: '1.0.0'
});
