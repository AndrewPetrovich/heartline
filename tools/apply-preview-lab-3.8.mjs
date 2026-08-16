import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_VERSION = '3.7.1';
const TARGET_VERSION = '3.8.0';
const backupRoot = path.join('.git', 'heartline-update-backups', TARGET_VERSION);

async function read(file) { return readFile(file, 'utf8'); }
async function backup(file) {
  try {
    const target = path.join(backupRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
  } catch (_) {}
}

const staged = new Map();
async function update(file, transform) {
  const before = await read(file);
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const normalized = before.replace(/\r\n/g, '\n');
  const transformed = await transform(normalized);
  if (transformed === normalized) throw new Error(`${file}: Preview Lab migration made no change`);
  const after = eol === '\r\n' ? transformed.replace(/\n/g, '\r\n') : transformed;
  staged.set(file, { before, after });
}

function replaceExact(source, oldValue, newValue, label) {
  const count = source.split(oldValue).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(oldValue, newValue);
}

function replaceSection(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`${label}: end marker not found`);
  if (source.indexOf(startMarker, start + 1) >= 0) throw new Error(`${label}: start marker is not unique`);
  return source.slice(0, start) + replacement + source.slice(end + endMarker.length);
}

const packageJson = JSON.parse(await read('package.json'));
if (packageJson.version !== EXPECTED_VERSION) {
  throw new Error(`HEARTLINE ${EXPECTED_VERSION} is required; found ${packageJson.version}`);
}

const previewRenderer = await read('tools/preview-lab-3.8/heartline-player-renderer.js');
if (!previewRenderer.includes('calculatePreviewScale') || previewRenderer.includes('DEVICE_PRESETS')) {
  throw new Error('Extract the complete HEARTLINE 3.8 package before running the migration: staged player renderer is missing');
}
const currentRenderer = await read('heartline-player-renderer.js');
if (!currentRenderer.includes('DEVICE_PRESETS')) {
  throw new Error('HEARTLINE 3.7.1 player renderer was not found. Refusing to overwrite an unexpected renderer.');
}
const rendererEol = currentRenderer.includes('\r\n') ? '\r\n' : '\n';
staged.set('heartline-player-renderer.js', {
  before: currentRenderer,
  after: rendererEol === '\r\n' ? previewRenderer.replace(/\r?\n/g, '\r\n') : previewRenderer.replace(/\r\n/g, '\n')
});
for (const requiredFile of [
  'hl-editor/preview/domain/device-profile.js',
  'hl-editor/preview/application/device-profile-service.js',
  'hl-editor/preview/infrastructure/builtin-device-profile-catalog.js',
  'hl-editor/preview/presentation/preview-lab.css',
  'tools/verify-preview-architecture.mjs'
]) {
  try { await read(requiredFile); }
  catch (_) { throw new Error(`Extract the complete HEARTLINE 3.8 package first: missing ${requiredFile}`); }
}

await update('heartline-app.js', source => {
  source = replaceExact(
    source,
    "import * as Assets from './hl-editor/application/asset-application-service.js';",
    "import * as Assets from './hl-editor/application/asset-application-service.js';\nimport { getAppServices } from './hl-editor/application/service-container.js';",
    'Preview Application service dependency'
  );
  source = replaceExact(
    source,
    "import { DEVICE_PRESETS, renderPlayerFrame, renderDeviceComparison, orientedDevice } from './heartline-player-renderer.js';",
    "import { renderPlayerFrame, renderDeviceComparison, calculatePreviewScale, orientedDevice } from './heartline-player-renderer.js';",
    'remove device catalog from renderer import'
  );
  source = replaceExact(
    source,
    "const parser = window.HEARTLINEParser;",
    "const parser = window.HEARTLINEParser;\nconst deviceProfileService = getAppServices().deviceProfileService;",
    'device profile service binding'
  );
  source = replaceExact(
    source,
    `  previewDeviceId: 'iphone390',
  previewOrientation: 'portrait',
  previewCompare: false,
  previewTextScale: 1,
  previewPanelStyle: 'glass',
  previewDraftAssignment: null,
  previewMobileSheet: 'none',`,
    `  previewDeviceId: deviceProfileService.defaultProfile().id,
  previewOrientation: 'portrait',
  previewCompare: false,
  previewCompareDeviceIds: deviceProfileService.comparisonPreset('essential').map(profile => profile.id),
  previewComparisonPreset: 'essential',
  previewScaleMode: 'fit',
  previewShowSafeArea: false,
  previewCustomDevice: { width: 390, height: 844, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0, fontSize: 17 },
  previewTextScale: 1,
  previewPanelStyle: 'glass',
  previewDraftAssignment: null,
  previewMobileSheet: 'none',`,
    'Preview state'
  );
  source = replaceSection(
    source,
    'async function renderPreview() {',
    'async function movePreview(delta) {',
    "function previewDeviceOptionsHtml() {\n  const groups = deviceProfileService.groupedProfiles();\n  return `${groups.map(group => `<optgroup label=\"${Domain.escapeHtml(group.family)}\">${group.profiles.map(device => `<option value=\"${Domain.escapeHtml(device.id)}\" ${device.id === state.previewDeviceId ? 'selected' : ''}>${Domain.escapeHtml(device.label)}</option>`).join('')}</optgroup>`).join('')}<optgroup label=\"\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c\u0441\u043a\u0438\u0439\"><option value=\"custom\" ${state.previewDeviceId === 'custom' ? 'selected' : ''}>\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c\u0441\u043a\u0438\u0439 viewport\u2026</option></optgroup>`;\n}\n\nfunction currentPreviewDevice() {\n  return deviceProfileService.resolve(state.previewDeviceId, state.previewCustomDevice);\n}\n\nfunction previewComparePickerHtml() {\n  const selected = new Set(deviceProfileService.normalizeComparison(state.previewCompareDeviceIds));\n  const groups = deviceProfileService.groupedProfiles();\n  return `<div class=\"preview-compare-presets\">\n    <button type=\"button\" class=\"button secondary small\" data-preview-preset=\"essential\" data-active=\"${state.previewComparisonPreset === 'essential'}\">\u041e\u0441\u043d\u043e\u0432\u043d\u044b\u0435 4</button>\n    <button type=\"button\" class=\"button secondary small\" data-preview-preset=\"ios\" data-active=\"${state.previewComparisonPreset === 'ios'}\">iOS</button>\n    <button type=\"button\" class=\"button secondary small\" data-preview-preset=\"android\" data-active=\"${state.previewComparisonPreset === 'android'}\">Android</button>\n    <button type=\"button\" class=\"button secondary small\" data-preview-preset=\"edge\" data-active=\"${state.previewComparisonPreset === 'edge'}\">\u0413\u0440\u0430\u043d\u0438\u0447\u043d\u044b\u0435</button>\n  </div>\n  <div class=\"preview-compare-picker\">${groups.flatMap(group => group.profiles.map(device => `<label class=\"preview-compare-device\"><input type=\"checkbox\" data-preview-compare-device=\"${Domain.escapeHtml(device.id)}\" ${selected.has(device.id) ? 'checked' : ''}><span>${Domain.escapeHtml(device.label)}${device.aliases?.length ? `<small>${Domain.escapeHtml(device.aliases[0])}</small>` : ''}</span></label>`)).join('')}</div>\n  <p class=\"preview-control-note\">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u043e ${deviceProfileService.maxComparisonDevices} \u043f\u0440\u043e\u0444\u0438\u043b\u0435\u0439. \u0413\u0435\u043e\u043c\u0435\u0442\u0440\u0438\u044f \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432 \u0445\u0440\u0430\u043d\u0438\u0442\u0441\u044f \u0432 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e\u043c \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0435, \u0430 \u043d\u0435 \u0432 Preview UI.</p>`;\n}\n\nfunction previewCustomDeviceHtml() {\n  if (state.previewDeviceId !== 'custom') return '';\n  const custom = state.previewCustomDevice;\n  return `<div class=\"preview-custom-grid\">\n    <label class=\"field\"><span>\u0428\u0438\u0440\u0438\u043d\u0430</span><input id=\"previewCustomWidth\" class=\"input\" type=\"number\" min=\"240\" max=\"2200\" value=\"${custom.width}\"></label>\n    <label class=\"field\"><span>\u0412\u044b\u0441\u043e\u0442\u0430</span><input id=\"previewCustomHeight\" class=\"input\" type=\"number\" min=\"320\" max=\"2400\" value=\"${custom.height}\"></label>\n    <label class=\"field\"><span>Safe top</span><input id=\"previewCustomSafeTop\" class=\"input\" type=\"number\" min=\"0\" max=\"240\" value=\"${custom.safeTop}\"></label>\n    <label class=\"field\"><span>Safe bottom</span><input id=\"previewCustomSafeBottom\" class=\"input\" type=\"number\" min=\"0\" max=\"240\" value=\"${custom.safeBottom}\"></label>\n    <label class=\"field\"><span>Safe left</span><input id=\"previewCustomSafeLeft\" class=\"input\" type=\"number\" min=\"0\" max=\"240\" value=\"${custom.safeLeft}\"></label>\n    <label class=\"field\"><span>Safe right</span><input id=\"previewCustomSafeRight\" class=\"input\" type=\"number\" min=\"0\" max=\"240\" value=\"${custom.safeRight}\"></label>\n  </div>`;\n}\n\nfunction previewSettingsFromControls() {\n  return {\n    focalPoint: {\n      x: Number($('previewFocalX')?.value ?? 0.5),\n      y: Number($('previewFocalY')?.value ?? 0.5)\n    },\n    zoom: Number($('previewZoom')?.value ?? 1),\n    overlayOpacity: Number($('previewOverlay')?.value ?? 0.12)\n  };\n}\n\nfunction updatePreviewDraft(frame, settings) {\n  const assignment = state.assignmentMap.get(frame.fragmentId) || frame.assignment;\n  if (!assignment) return;\n  if ($('previewUseOverride')?.checked) {\n    state.previewDraftAssignment = {\n      ...assignment,\n      deviceOverrides: {\n        ...(assignment.deviceOverrides || {}),\n        [state.previewDeviceId]: {\n          ...(assignment.deviceOverrides?.[state.previewDeviceId] || {}),\n          ...settings\n        }\n      }\n    };\n  } else {\n    state.previewDraftAssignment = { ...assignment, ...settings };\n  }\n}\n\nfunction warningAction(code) {\n  if (['missing-visual', 'low-resolution'].includes(code)) return { key: 'asset', label: '\u0418\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435' };\n  if (['many-lines', 'panel-ratio', 'text-overflow', 'min-text-size', 'touch-target'].includes(code)) return { key: 'text', label: '\u0422\u0435\u043a\u0441\u0442' };\n  if (code === 'focal-overlap') return { key: 'focal', label: '\u041a\u0430\u0434\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435' };\n  if (code === 'safe-area-overlap') return { key: 'safe', label: 'Safe area' };\n  return null;\n}\n\nfunction diagnosticDimensionStatus(diagnostics, codes) {\n  const relevant = diagnostics.warnings.filter(item => codes.includes(item.code));\n  if (relevant.some(item => item.level === 'error')) return 'error';\n  if (relevant.length) return 'warning';\n  return 'good';\n}\n\nfunction previewMatrixHtml(results) {\n  if (results.length < 2) return '';\n  const dimensions = [\n    ['\u0422\u0435\u043a\u0441\u0442', ['many-lines', 'panel-ratio', 'text-overflow', 'min-text-size']],\n    ['Safe area', ['safe-area-overlap']],\n    ['\u0418\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435', ['missing-visual', 'low-resolution', 'focal-overlap']],\n    ['Choice', ['many-options', 'touch-target']]\n  ];\n  const icon = status => status === 'good' ? '\u2713' : status === 'warning' ? '\u26a0' : '\u2715';\n  return `<div class=\"preview-matrix-wrap\"><table class=\"preview-matrix\"><thead><tr><th>\u0423\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e</th>${dimensions.map(([label]) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${results.map(result => `<tr><td>${Domain.escapeHtml(result.device.label)}</td>${dimensions.map(([, codes]) => { const status = diagnosticDimensionStatus(result.diagnostics, codes); return `<td><span class=\"preview-matrix-status\" data-status=\"${status}\">${icon(status)}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;\n}\n\nfunction previewDiagnosticsHtml(results) {\n  const allWarnings = results.flatMap(result => result.diagnostics.warnings || []);\n  const errors = allWarnings.filter(item => item.level === 'error').length;\n  const warnings = allWarnings.length - errors;\n  const status = errors ? 'error' : warnings ? 'warning' : 'good';\n  const title = errors ? '\u0422\u0440\u0435\u0431\u0443\u0435\u0442 \u0438\u0441\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f' : warnings ? '\u0415\u0441\u0442\u044c \u0437\u0430\u043c\u0435\u0447\u0430\u043d\u0438\u044f' : '\u041a\u0430\u0434\u0440 \u0433\u043e\u0442\u043e\u0432';\n  const body = errors\n    ? `${errors} \u043a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0445 \u043f\u0440\u043e\u0431\u043b\u0435\u043c \u00b7 ${warnings} \u043f\u0440\u0435\u0434\u0443\u043f\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u0439`\n    : warnings ? `${warnings} \u043f\u0440\u0435\u0434\u0443\u043f\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u0439, \u043a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0445 \u043f\u0440\u043e\u0431\u043b\u0435\u043c \u043d\u0435\u0442` : '\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u043f\u0440\u043e\u0439\u0434\u0435\u043d\u044b \u043d\u0430 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0445 \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u0430\u0445';\n\n  return `<section class=\"preview-readiness\" data-status=\"${status}\"><span>\u0413\u043e\u0442\u043e\u0432\u043d\u043e\u0441\u0442\u044c \u043a\u0430\u0434\u0440\u0430</span><strong>${title}</strong><p>${body}</p></section>\n    ${results.map(result => `<section class=\"preview-diagnostic-device\"><header><strong>${Domain.escapeHtml(result.device.label)}</strong><span>${result.diagnostics.fontSize || '\u2014'} px \u00b7 \u043f\u0430\u043d\u0435\u043b\u044c ${Math.round(result.diagnostics.ratio * 100)}%</span></header>\n      ${result.diagnostics.warnings.length\n        ? result.diagnostics.warnings.map(item => { const action = warningAction(item.code); return `<div class=\"preview-diagnostic-item\" data-level=\"${Domain.escapeHtml(item.level)}\"><span>${Domain.escapeHtml(item.text)}</span>${action ? `<button type=\"button\" data-preview-fix=\"${action.key}\">${action.label} \u2192</button>` : ''}</div>`; }).join('')\n        : '<div class=\"preview-diagnostic-item\" data-level=\"good\"><span>\u041a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0445 \u043f\u0440\u043e\u0431\u043b\u0435\u043c \u043d\u0435 \u043e\u0431\u043d\u0430\u0440\u0443\u0436\u0435\u043d\u043e.</span></div>'}\n    </section>`).join('')}${previewMatrixHtml(results)}`;\n}\n\nasync function openPreviewInProofreading() {\n  await persistWorkspaceSelection();\n  if (window.HEARTLINEProofreading?.open) return window.HEARTLINEProofreading.open();\n  return setRoute('reader');\n}\n\nasync function renderPreview() {\n  if (!state.project) return renderNoProject('\u041f\u0440\u0435\u0432\u044c\u044e');\n  const frame = effectiveFrame();\n  if (!frame) return renderNoProject('\u041f\u0440\u0435\u0432\u044c\u044e');\n  const device = currentPreviewDevice();\n  const deviceVisual = Domain.visualForDevice(frame.assignment, device.id);\n  const hasOverride = Boolean(frame.assignment?.deviceOverrides?.[state.previewDeviceId]);\n\n  view.className = 'view';\n  view.innerHTML = `<section class=\"page full\"><div class=\"preview-layout\">\n    <aside class=\"preview-controls ${state.previewMobileSheet === 'controls' ? 'mobile-open' : ''}\">\n      <div class=\"preview-sheet-head\"><strong>\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043f\u0440\u0435\u0432\u044c\u044e</strong><button id=\"closePreviewControls\" class=\"icon-button\" type=\"button\">\u00d7</button></div>\n      <span class=\"kicker\">PREVIEW LAB</span><h2 style=\"margin:5px 0 16px\">\u042d\u043a\u0440\u0430\u043d \u0438 \u043a\u0430\u0434\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435</h2>\n      <div class=\"preview-control-group\">\n        <label class=\"field\"><span>\u0423\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e</span><select id=\"previewDevice\" class=\"select\">${previewDeviceOptionsHtml()}</select></label>\n        ${previewCustomDeviceHtml()}\n        <label class=\"field\"><span>\u041e\u0440\u0438\u0435\u043d\u0442\u0430\u0446\u0438\u044f</span><select id=\"previewOrientation\" class=\"select\"><option value=\"portrait\">\u0412\u0435\u0440\u0442\u0438\u043a\u0430\u043b\u044c\u043d\u0430\u044f</option><option value=\"landscape\">\u0413\u043e\u0440\u0438\u0437\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u0430\u044f</option></select></label>\n        <label class=\"field\"><span>\u0420\u0435\u0436\u0438\u043c</span><select id=\"previewCompare\" class=\"select\"><option value=\"single\">\u041e\u0434\u043d\u043e \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e</option><option value=\"compare\">\u0421\u0440\u0430\u0432\u043d\u0435\u043d\u0438\u0435 \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432</option></select></label>\n        ${state.previewCompare ? previewComparePickerHtml() : ''}\n      </div>\n      <div class=\"preview-control-group\"><h3>\u041a\u0430\u0434\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435</h3>\n        <p class=\"preview-control-note\">\u041c\u043e\u0436\u043d\u043e \u043f\u0435\u0440\u0435\u0442\u0430\u0441\u043a\u0438\u0432\u0430\u0442\u044c focal point \u043f\u0440\u044f\u043c\u043e \u043d\u0430 \u043f\u0440\u0435\u0432\u044c\u044e. Ctrl/\u2318 + \u043a\u043e\u043b\u0435\u0441\u043e \u043c\u0435\u043d\u044f\u0435\u0442 Zoom.</p>\n        <label class=\"field\"><span>Focal X</span><input id=\"previewFocalX\" type=\"range\" min=\"0\" max=\"1\" step=\"0.01\" value=\"${deviceVisual.focalPoint.x}\"></label>\n        <label class=\"field\"><span>Focal Y</span><input id=\"previewFocalY\" type=\"range\" min=\"0\" max=\"1\" step=\"0.01\" value=\"${deviceVisual.focalPoint.y}\"></label>\n        <label class=\"field\"><span>Zoom</span><input id=\"previewZoom\" type=\"range\" min=\"1\" max=\"2.2\" step=\"0.02\" value=\"${deviceVisual.zoom}\"></label>\n        <label class=\"field\"><span>\u041f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u043e\u0441\u0442\u044c \u043f\u0430\u043d\u0435\u043b\u0438</span><input id=\"previewOverlay\" type=\"range\" min=\"0\" max=\"0.35\" step=\"0.01\" value=\"${deviceVisual.overlayOpacity}\"></label>\n        <label class=\"field\" style=\"grid-template-columns:auto 1fr;align-items:center\"><input id=\"previewUseOverride\" type=\"checkbox\" ${hasOverride ? 'checked' : ''}><span>\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f ${Domain.escapeHtml(device.label)}</span></label>\n        <button id=\"savePreviewCrop\" class=\"button primary small\">\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043a\u0430\u0434\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435</button>\n      </div>\n      <div class=\"preview-control-group\"><h3>\u0422\u0435\u043a\u0441\u0442 \u0438 \u043f\u0430\u043d\u0435\u043b\u044c</h3>\n        <label class=\"field\"><span>\u041c\u0430\u0441\u0448\u0442\u0430\u0431 \u0442\u0435\u043a\u0441\u0442\u0430</span><input id=\"previewTextScale\" type=\"range\" min=\"0.8\" max=\"1.4\" step=\"0.05\" value=\"${state.previewTextScale}\"></label>\n        <label class=\"field\"><span>\u0421\u0442\u0438\u043b\u044c \u043f\u0430\u043d\u0435\u043b\u0438</span><select id=\"previewPanelStyle\" class=\"select\"><option value=\"glass\">\u0421\u0432\u0435\u0442\u043b\u043e\u0435 \u0441\u0442\u0435\u043a\u043b\u043e</option><option value=\"solid\">\u041f\u043b\u043e\u0442\u043d\u0430\u044f</option></select></label>\n      </div>\n      <div class=\"preview-control-group\"><h3>\u041a\u0430\u0434\u0440</h3><p><strong>${Domain.escapeHtml(frame.speaker || Domain.textTypeLabel(frame.type))}</strong><br><span class=\"muted\">${Domain.escapeHtml(frame.chapterTitle || '')} \u00b7 ${Domain.escapeHtml(frame.sceneTitle || '')}</span></p></div>\n    </aside>\n\n    <div class=\"preview-mobile-actions\"><button id=\"mobilePreviewSettings\" class=\"button secondary small\">\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438</button><button id=\"mobilePreviewDiagnostics\" class=\"button secondary small\">\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430</button></div>\n\n    <main class=\"preview-main\">\n      <div class=\"preview-stage-toolbar\">\n        <div class=\"preview-stage-title\"><strong>${Domain.escapeHtml(device.label)}</strong><span>${state.previewOrientation === 'landscape' ? '\u0413\u043e\u0440\u0438\u0437\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u0430\u044f' : '\u0412\u0435\u0440\u0442\u0438\u043a\u0430\u043b\u044c\u043d\u0430\u044f'} \u043e\u0440\u0438\u0435\u043d\u0442\u0430\u0446\u0438\u044f${state.previewCompare ? ' \u00b7 \u0441\u0440\u0430\u0432\u043d\u0435\u043d\u0438\u0435' : ''}</span></div>\n        <div class=\"preview-stage-tools\">\n          <select id=\"previewScaleMode\" class=\"select preview-scale-select\"><option value=\"fit\">Fit</option><option value=\"0.5\">50%</option><option value=\"0.75\">75%</option><option value=\"1\">100%</option><option value=\"1.25\">125%</option></select>\n          <label class=\"preview-safe-toggle\"><input id=\"previewShowSafeArea\" type=\"checkbox\" ${state.previewShowSafeArea ? 'checked' : ''}> Safe area</label>\n        </div>\n      </div>\n      <div id=\"previewStage\" class=\"preview-stage\" data-mode=\"${state.previewCompare ? 'compare' : 'single'}\"></div>\n      <div class=\"preview-stage-nav\"><button id=\"previewPrev\" class=\"button secondary\">\u2190 \u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0439</button><button id=\"previewReader\" class=\"button secondary\">\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0432 \u0432\u044b\u0447\u0438\u0442\u043a\u0435</button><button id=\"previewNext\" class=\"button primary\">\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u2192</button></div>\n    </main>\n\n    <aside class=\"preview-diagnostics ${state.previewMobileSheet === 'diagnostics' ? 'mobile-open' : ''}\">\n      <div class=\"preview-sheet-head\"><strong>\u0414\u0438\u0430\u0433\u043d\u043e\u0441\u0442\u0438\u043a\u0430</strong><button id=\"closePreviewDiagnostics\" class=\"icon-button\" type=\"button\">\u00d7</button></div>\n      <span class=\"kicker\">QUALITY CHECK</span><h2 style=\"margin:5px 0 14px\">\u0413\u043e\u0442\u043e\u0432\u043d\u043e\u0441\u0442\u044c \u043a\u0430\u0434\u0440\u0430</h2><div id=\"previewDiagnostics\"></div>\n    </aside>\n  </div></section>`;\n\n  $('previewOrientation').value = state.previewOrientation;\n  $('previewCompare').value = state.previewCompare ? 'compare' : 'single';\n  $('previewPanelStyle').value = state.previewPanelStyle;\n  $('previewScaleMode').value = state.previewScaleMode;\n  await renderPreviewStage();\n\n  $('previewDevice').onchange = () => {\n    state.previewDeviceId = $('previewDevice').value;\n    state.previewDraftAssignment = null;\n    renderPreview();\n  };\n  $('previewOrientation').onchange = () => {\n    state.previewOrientation = $('previewOrientation').value;\n    renderPreviewStage();\n  };\n  $('previewCompare').onchange = () => {\n    state.previewCompare = $('previewCompare').value === 'compare';\n    renderPreview();\n  };\n  $('previewPanelStyle').onchange = () => {\n    state.previewPanelStyle = $('previewPanelStyle').value;\n    renderPreviewStage();\n  };\n  $('previewScaleMode').onchange = () => {\n    state.previewScaleMode = $('previewScaleMode').value;\n    renderPreviewStage();\n  };\n  $('previewShowSafeArea').onchange = () => {\n    state.previewShowSafeArea = $('previewShowSafeArea').checked;\n    renderPreviewStage();\n  };\n\n  for (const id of ['previewFocalX', 'previewFocalY', 'previewZoom', 'previewOverlay', 'previewTextScale']) {\n    $(id).oninput = () => {\n      state.previewTextScale = Number($('previewTextScale').value);\n      updatePreviewDraft(frame, previewSettingsFromControls());\n      renderPreviewStage();\n    };\n  }\n\n  view.querySelectorAll('[data-preview-preset]').forEach(button => button.onclick = () => {\n    state.previewComparisonPreset = button.dataset.previewPreset;\n    state.previewCompareDeviceIds = deviceProfileService.comparisonPreset(state.previewComparisonPreset).map(item => item.id);\n    renderPreview();\n  });\n  view.querySelectorAll('[data-preview-compare-device]').forEach(input => input.onchange = () => {\n    const next = new Set(state.previewCompareDeviceIds);\n    if (input.checked) {\n      if (next.size >= deviceProfileService.maxComparisonDevices) {\n        input.checked = false;\n        return toast(`\u041c\u043e\u0436\u043d\u043e \u0441\u0440\u0430\u0432\u043d\u0438\u0432\u0430\u0442\u044c \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 ${deviceProfileService.maxComparisonDevices} \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432`);\n      }\n      next.add(input.dataset.previewCompareDevice);\n    } else {\n      next.delete(input.dataset.previewCompareDevice);\n      if (!next.size) {\n        input.checked = true;\n        return toast('\u041e\u0441\u0442\u0430\u0432\u044c\u0442\u0435 \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u043d\u043e \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e');\n      }\n    }\n    state.previewCompareDeviceIds = deviceProfileService.normalizeComparison([...next]);\n    state.previewComparisonPreset = 'custom';\n    renderPreviewStage();\n  });\n\n  if (state.previewDeviceId === 'custom') {\n    const customFields = {\n      previewCustomWidth: 'width', previewCustomHeight: 'height',\n      previewCustomSafeTop: 'safeTop', previewCustomSafeBottom: 'safeBottom',\n      previewCustomSafeLeft: 'safeLeft', previewCustomSafeRight: 'safeRight'\n    };\n    for (const [id, key] of Object.entries(customFields)) {\n      $(id).oninput = () => {\n        state.previewCustomDevice = { ...state.previewCustomDevice, [key]: Number($(id).value) };\n        renderPreviewStage();\n      };\n    }\n  }\n\n  $('savePreviewCrop').onclick = async () => {\n    const assignment = currentAssignment();\n    const settings = previewSettingsFromControls();\n    let after;\n    if ($('previewUseOverride').checked) {\n      after = {\n        ...assignment,\n        deviceOverrides: {\n          ...(assignment.deviceOverrides || {}),\n          [state.previewDeviceId]: { ...(assignment.deviceOverrides?.[state.previewDeviceId] || {}), ...settings }\n        },\n        status: assignment.status === 'approved' ? 'needs-review' : assignment.status,\n        updatedAt: Domain.now()\n      };\n    } else {\n      const overrides = { ...(assignment.deviceOverrides || {}) };\n      delete overrides[state.previewDeviceId];\n      after = {\n        ...assignment, ...settings, deviceOverrides: overrides,\n        status: assignment.status === 'approved' ? 'needs-review' : assignment.status,\n        updatedAt: Domain.now()\n      };\n    }\n    state.previewDraftAssignment = null;\n    await applyAssignmentChange(frame.fragmentId, after, 'preview crop');\n    toast('\u041a\u0430\u0434\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e');\n    renderPreview();\n  };\n\n  $('previewPrev').onclick = () => movePreview(-1);\n  $('previewNext').onclick = () => movePreview(1);\n  $('previewReader').onclick = openPreviewInProofreading;\n  $('mobilePreviewSettings').onclick = () => { state.previewMobileSheet = state.previewMobileSheet === 'controls' ? 'none' : 'controls'; renderPreview(); };\n  $('mobilePreviewDiagnostics').onclick = () => { state.previewMobileSheet = state.previewMobileSheet === 'diagnostics' ? 'none' : 'diagnostics'; renderPreview(); };\n  $('closePreviewControls').onclick = () => { state.previewMobileSheet = 'none'; renderPreview(); };\n  $('closePreviewDiagnostics').onclick = () => { state.previewMobileSheet = 'none'; renderPreview(); };\n}\n\nasync function renderPreviewStage() {\n  const host = $('previewStage');\n  if (!host) return;\n  const frame = effectiveFrame();\n  const assetUrl = frame?.asset ? await Assets.assetObjectUrl(frame.asset.assetId) : null;\n  let results;\n\n  if (state.previewCompare) {\n    const ids = deviceProfileService.normalizeComparison(state.previewCompareDeviceIds);\n    const devices = ids.map(id => deviceProfileService.get(id)).filter(Boolean);\n    const availableWidth = Math.max(600, host.clientWidth || 900);\n    const availableHeight = Math.max(420, host.clientHeight || 650);\n    const perDeviceWidth = Math.max(220, availableWidth / Math.max(1, Math.min(devices.length, 4)) - 34);\n    results = renderDeviceComparison(host, devices.map(device => ({\n      frame, device, orientation: state.previewOrientation, assetUrl,\n      textScale: state.previewTextScale, panelStyle: state.previewPanelStyle,\n      showSafeArea: state.previewShowSafeArea,\n      scale: calculatePreviewScale(device, state.previewOrientation, {\n        mode: 'fit',\n        availableWidth: perDeviceWidth,\n        availableHeight: availableHeight - 80,\n        fitFraction: .9,\n        maxScale: .72\n      })\n    })));\n  } else {\n    const device = currentPreviewDevice();\n    const scale = calculatePreviewScale(device, state.previewOrientation, {\n      mode: state.previewScaleMode,\n      availableWidth: host.clientWidth || 900,\n      availableHeight: host.clientHeight || 720,\n      fitFraction: .84,\n      maxScale: 1.25\n    });\n    const diagnostics = renderPlayerFrame(host, {\n      frame, device, orientation: state.previewOrientation, assetUrl,\n      textScale: state.previewTextScale, panelStyle: state.previewPanelStyle,\n      scale, scaleToFit: false,\n      showSafeArea: state.previewShowSafeArea,\n      showFocalPoint: Boolean(assetUrl),\n      onChoose: optionId => toast(`Preview \u0432\u044b\u0431\u043e\u0440\u0430: ${optionId}`),\n      onFocalPointChange: (point, meta) => {\n        if ($('previewFocalX')) $('previewFocalX').value = String(point.x);\n        if ($('previewFocalY')) $('previewFocalY').value = String(point.y);\n        updatePreviewDraft(frame, { ...previewSettingsFromControls(), focalPoint: point });\n        if (meta?.commit) renderPreviewStage();\n      },\n      onZoomChange: zoom => {\n        if ($('previewZoom')) $('previewZoom').value = String(zoom);\n        updatePreviewDraft(frame, { ...previewSettingsFromControls(), zoom });\n        renderPreviewStage();\n      }\n    });\n    results = [{ device, diagnostics }];\n  }\n\n  const diagnosticHost = $('previewDiagnostics');\n  if (diagnosticHost) {\n    diagnosticHost.innerHTML = previewDiagnosticsHtml(results);\n    diagnosticHost.querySelectorAll('[data-preview-fix]').forEach(button => button.onclick = () => {\n      const action = button.dataset.previewFix;\n      if (action === 'asset') {\n        $('frameAssetInput').value = '';\n        $('frameAssetInput').click();\n      } else if (action === 'text') {\n        state.previewTextScale = Math.max(.8, Number((state.previewTextScale - .05).toFixed(2)));\n        if ($('previewTextScale')) $('previewTextScale').value = String(state.previewTextScale);\n        renderPreviewStage();\n      } else if (action === 'safe') {\n        state.previewShowSafeArea = true;\n        if ($('previewShowSafeArea')) $('previewShowSafeArea').checked = true;\n        renderPreviewStage();\n      } else if (action === 'focal') {\n        $('previewFocalY')?.focus();\n        state.previewShowSafeArea = true;\n        if ($('previewShowSafeArea')) $('previewShowSafeArea').checked = true;\n        renderPreviewStage();\n      }\n    });\n  }\n}\n\nasync function movePreview(delta) {",
    'Preview workspace replacement'
  );

  source = replaceSection(
    source,
    "  const [engineSource, domainSource, playerSource] = await Promise.all(",
    "  exporter.downloadBytes(",
    `  const [engineSourceRaw, domainSource, playerSourceRaw, storyRuntimeSource, genericStoryProfileSource, legacyStoryProfileSource, deviceProfileSource] = await Promise.all([
    fetch('./heartline-engine.js').then(r => r.text()),
    fetch('./heartline-domain.js').then(r => r.text()),
    fetch('./heartline-player-renderer.js').then(r => r.text()),
    fetch('./hl-editor/application/story-profile-runtime.js').then(r => r.text()),
    fetch('./hl-editor/infrastructure/story-profiles/generic-story-profile.js').then(r => r.text()),
    fetch('./hl-editor/infrastructure/story-profiles/legacy-heartline-story-profile.js').then(r => r.text()),
    fetch('./hl-editor/preview/domain/device-profile.js').then(r => r.text())
  ]);
  const engineSource = engineSourceRaw
    .replace("./heartline-domain.js", "./domain.js")
    .replace("./hl-editor/application/story-profile-runtime.js", "./story-profile-runtime.js");
  const playerSource = playerSourceRaw
    .replace("./heartline-domain.js", "./domain.js")
    .replace("./hl-editor/preview/domain/device-profile.js", "./device-profile.js");
  entries.push(
    { name: 'runtime.json', data: JSON.stringify(runtime) },
    { name: 'engine.js', data: engineSource },
    { name: 'domain.js', data: domainSource },
    { name: 'player-renderer.js', data: playerSource },
    { name: 'story-profile-runtime.js', data: storyRuntimeSource },
    { name: 'generic-story-profile.js', data: genericStoryProfileSource },
    { name: 'legacy-heartline-story-profile.js', data: legacyStoryProfileSource },
    { name: 'device-profile.js', data: deviceProfileSource },
    { name: 'index.html', data: runtimeIndexHtml() },
    { name: 'runtime-player.js', data: runtimePlayerJs() },
    { name: 'runtime.css', data: runtimeCss() }
  );
  exporter.downloadBytes(`,
    'runtime module closure'
  );

  source = replaceExact(
    source,
    "const data=await fetch('./runtime.json').then(r=>r.json());",
    "const [{setStoryProfileResolver},{GenericStoryProfile},{LegacyHeartlineStoryProfile}]=await Promise.all([import('./story-profile-runtime.js'),import('./generic-story-profile.js'),import('./legacy-heartline-story-profile.js')]);setStoryProfileResolver(content=>LegacyHeartlineStoryProfile.matches(content)?LegacyHeartlineStoryProfile:GenericStoryProfile);const data=await fetch('./runtime.json').then(r=>r.json());",
    'runtime story profile bootstrap'
  );
  return source;
});

await update('heartline-domain.js', source => replaceSection(
  source,
  'export function frameDiagnostics(frame, device, visualSettings, textScale = 1) {',
  'export function recordHistory(workspace, event) {',
  "export function frameDiagnostics(frame, device, visualSettings, textScale = 1) {\n  const width = Number(device.width || 390);\n  const height = Number(device.height || 844);\n  const safeTop = Number(device.safeTop || 0);\n  const safeRight = Number(device.safeRight || 0);\n  const safeBottom = Number(device.safeBottom || 0);\n  const safeLeft = Number(device.safeLeft || 0);\n  const usableWidth = Math.max(120, width - safeLeft - safeRight);\n  const usableHeight = Math.max(160, height - safeTop - safeBottom);\n  const fontSize = Math.max(10, Math.round((device.fontSize || 17) * textScale));\n  const approximateCharsPerLine = Math.max(16, Math.floor((usableWidth - 48) / (fontSize * 0.52)));\n  const text = frame?.text || '';\n  const lines = Math.max(1, Math.ceil(text.length / approximateCharsPerLine));\n  const speakerLines = frame?.speaker ? 1 : 0;\n  const optionLines = frame?.options?.length\n    ? frame.options.reduce((sum, option) => sum + Math.max(1, Math.ceil(option.label.length / approximateCharsPerLine)), 0)\n    : 0;\n  const lineHeight = fontSize * 1.42;\n  const optionSpacing = optionLines ? frame.options.length * 12 : 0;\n  const panelHeight = 40 + (lines + speakerLines + optionLines) * lineHeight + optionSpacing;\n  const ratio = panelHeight / usableHeight;\n  const warnings = [];\n\n  if (!frame?.assignment?.assetId) {\n    warnings.push({ code: 'missing-visual', level: 'error', text: '\u0418\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u043d\u0435 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u043e.' });\n  }\n  if (frame?.asset && (frame.asset.width < width * 2 || frame.asset.height < height * 1.2)) {\n    warnings.push({ code: 'low-resolution', level: 'warning', text: '\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0438\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c \u043d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u044b\u043c \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e viewport.' });\n  }\n  if (fontSize < 15) {\n    warnings.push({ code: 'min-text-size', level: 'error', text: `\u0422\u0435\u043a\u0441\u0442 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u0435\u043b\u043a\u0438\u0439: \u043e\u043a\u043e\u043b\u043e ${fontSize}px.` });\n  } else if (fontSize < 16) {\n    warnings.push({ code: 'min-text-size', level: 'warning', text: `\u0420\u0430\u0437\u043c\u0435\u0440 \u0442\u0435\u043a\u0441\u0442\u0430 \u043e\u043a\u043e\u043b\u043e ${fontSize}px \u2014 \u043f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0447\u0438\u0442\u0430\u0435\u043c\u043e\u0441\u0442\u044c.` });\n  }\n  if (lines > 8) {\n    warnings.push({ code: 'many-lines', level: 'warning', text: `\u0422\u0435\u043a\u0441\u0442 \u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442 \u043e\u043a\u043e\u043b\u043e ${lines} \u0441\u0442\u0440\u043e\u043a. \u0420\u0430\u0441\u0441\u043c\u043e\u0442\u0440\u0438\u0442\u0435 \u0440\u0430\u0437\u0434\u0435\u043b\u0435\u043d\u0438\u0435 \u0440\u0435\u043f\u043b\u0438\u043a\u0438.` });\n  }\n  if (ratio > 0.5) {\n    warnings.push({ code: 'panel-ratio', level: 'error', text: `\u0422\u0435\u043a\u0441\u0442\u043e\u0432\u0430\u044f \u043f\u0430\u043d\u0435\u043b\u044c \u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442 \u043e\u043a\u043e\u043b\u043e ${Math.round(ratio * 100)}% \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0439 \u0432\u044b\u0441\u043e\u0442\u044b.` });\n  } else if (ratio > 0.36) {\n    warnings.push({ code: 'panel-ratio', level: 'warning', text: `\u0422\u0435\u043a\u0441\u0442\u043e\u0432\u0430\u044f \u043f\u0430\u043d\u0435\u043b\u044c \u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442 \u043e\u043a\u043e\u043b\u043e ${Math.round(ratio * 100)}% \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0439 \u0432\u044b\u0441\u043e\u0442\u044b.` });\n  }\n\n  const focalY = visualSettings?.focalPoint?.y ?? 0.5;\n  const panelTop = 1 - (panelHeight + safeBottom + 10) / height;\n  if (focalY > panelTop) {\n    warnings.push({ code: 'focal-overlap', level: 'warning', text: '\u0422\u0435\u043a\u0441\u0442\u043e\u0432\u0430\u044f \u043f\u0430\u043d\u0435\u043b\u044c \u043f\u0435\u0440\u0435\u043a\u0440\u044b\u0432\u0430\u0435\u0442 focal point \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f.' });\n  }\n\n  const optionTargetHeight = fontSize * 1.42 * .82 + 20;\n  if (frame?.options?.length && optionTargetHeight < 44) {\n    warnings.push({ code: 'touch-target', level: 'warning', text: '\u0412\u0430\u0440\u0438\u0430\u043d\u0442\u044b \u0432\u044b\u0431\u043e\u0440\u0430 \u043c\u043e\u0433\u0443\u0442 \u0438\u043c\u0435\u0442\u044c \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u0430\u043b\u0435\u043d\u044c\u043a\u0443\u044e touch-area.' });\n  }\n  if (frame?.options?.length > 4) {\n    warnings.push({ code: 'many-options', level: 'warning', text: '\u041d\u0430 \u044d\u043a\u0440\u0430\u043d\u0435 \u0431\u043e\u043b\u044c\u0448\u0435 \u0447\u0435\u0442\u044b\u0440\u0451\u0445 \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u043e\u0432 \u0432\u044b\u0431\u043e\u0440\u0430.' });\n  }\n\n  return {\n    lines,\n    fontSize,\n    panelHeight: Math.round(panelHeight),\n    ratio,\n    safeArea: { top: safeTop, right: safeRight, bottom: safeBottom, left: safeLeft },\n    usableWidth,\n    usableHeight,\n    optionTargetHeight: Math.round(optionTargetHeight),\n    warnings,\n    ok: !warnings.some(item => item.level === 'error')\n  };\n}\n\nexport function recordHistory(workspace, event) {",
  'Preview diagnostics'
));

await update('hl-editor/bootstrap/composition-root.js', source => {
  source = replaceExact(
    source,
    "import { SampleCatalogService } from '../application/sample-catalog-service.js';",
    "import { SampleCatalogService } from '../application/sample-catalog-service.js';\nimport { DeviceProfileService } from '../preview/application/device-profile-service.js';\nimport { BUILTIN_DEVICE_PROFILE_CATALOG, BUILTIN_DEVICE_COMPARISON_PRESETS, DEFAULT_PREVIEW_DEVICE_ID } from '../preview/infrastructure/builtin-device-profile-catalog.js';",
    'Preview service imports'
  );
  source = replaceExact(
    source,
    "const sampleCatalogService = new SampleCatalogService(new BrowserSampleCatalogRepository('./samples/catalog.json'));",
    "const sampleCatalogService = new SampleCatalogService(new BrowserSampleCatalogRepository('./samples/catalog.json'));\nconst deviceProfileService = new DeviceProfileService(BUILTIN_DEVICE_PROFILE_CATALOG, {\n  defaultId: DEFAULT_PREVIEW_DEVICE_ID,\n  comparisonPresets: BUILTIN_DEVICE_COMPARISON_PRESETS,\n  maxComparisonDevices: 4\n});",
    'Preview service construction'
  );
  source = replaceExact(
    source,
    "  storyProfileRegistry,\n  sampleCatalogService\n});",
    "  storyProfileRegistry,\n  sampleCatalogService,\n  deviceProfileService\n});",
    'Preview service registration'
  );
  source = source.replace(
    "window.HEARTLINEApp = Object.freeze({ services: appServices, version: '3.7.0' });",
    "window.HEARTLINEApp = Object.freeze({ services: appServices, version: window.HEARTLINE_BUILD || 'current' });"
  );
  return source;
});

await update('index.html', source => {
  source = replaceExact(source, '<title>HEARTLINE Editor 3.7.1</title>', '<title>HEARTLINE Editor 3.8.0</title>', 'HTML version');
  source = replaceExact(
    source,
    '  <link rel="stylesheet" href="heartline-typography.css" />',
    '  <link rel="stylesheet" href="heartline-typography.css" />\n  <link rel="stylesheet" href="hl-editor/preview/presentation/preview-lab.css" />',
    'Preview stylesheet'
  );
  source = replaceExact(
    source,
    "window.HEARTLINE_BUILD='3.7.1-architecture-consolidation'",
    "window.HEARTLINE_BUILD='3.8.0-preview-lab'",
    'build id'
  );
  return source;
});

await update('sw.js', source => {
  source = replaceExact(source, "const CACHE='heartline-editor-3.7.1-architecture-consolidation';", "const CACHE='heartline-editor-3.8.0-preview-lab';", 'service worker cache');
  source = replaceExact(
    source,
    "'./heartline-typography.css'",
    "'./heartline-typography.css','./hl-editor/preview/presentation/preview-lab.css'",
    'Preview CSS offline cache'
  );
  source = replaceExact(
    source,
    "'./hl-editor/bootstrap/composition-root.js'",
    "'./hl-editor/bootstrap/composition-root.js','./hl-editor/preview/domain/device-profile.js','./hl-editor/preview/application/device-profile-service.js','./hl-editor/preview/infrastructure/builtin-device-profile-catalog.js'",
    'Preview modules offline cache'
  );
  return source;
});

await update('tools/verify-repository.mjs', source => replaceExact(
  source,
  "'hl-editor/presentation/presentation-coordinator.js','hl-editor/bootstrap/composition-root.js'",
  "'hl-editor/presentation/presentation-coordinator.js','hl-editor/bootstrap/composition-root.js','hl-editor/preview/domain/device-profile.js','hl-editor/preview/application/device-profile-service.js','hl-editor/preview/infrastructure/builtin-device-profile-catalog.js','hl-editor/preview/presentation/preview-lab.css'",
  'Preview repository completeness'
));

packageJson.version = TARGET_VERSION;
packageJson.scripts['verify-preview'] = 'node tools/verify-preview-architecture.mjs';
packageJson.scripts.check = 'node tools/check-js-syntax.mjs && node tools/verify-font-policy.mjs && node tools/verify-architecture.mjs && node tools/verify-preview-architecture.mjs';
staged.set('package.json', {
  before: await read('package.json'),
  after: JSON.stringify(packageJson, null, 2) + '\n'
});

for (const [file] of staged) await backup(file);
const written = [];
try {
  for (const [file, value] of staged) {
    await writeFile(file, value.after, 'utf8');
    written.push(file);
  }
} catch (error) {
  for (const file of written.reverse()) {
    try { await writeFile(file, staged.get(file).before, 'utf8'); } catch (_) {}
  }
  throw error;
}

await rm('tools/preview-lab-3.8', { recursive: true, force: true });

console.log(`HEARTLINE 3.8 Preview Lab applied (${staged.size} files updated).`);
console.log('Next on Windows: npm.cmd run verify-repository && npm.cmd test && npm.cmd run check');
