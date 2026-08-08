import { escapeHtml, frameDiagnostics, visualForDevice } from './heartline-domain.js';

export const DEVICE_PRESETS = {
  compact: { id: 'compact', label: 'Компактный · 320×568', width: 320, height: 568, safeTop: 20, safeBottom: 16, fontSize: 16 },
  android360: { id: 'android360', label: 'Android · 360×800', width: 360, height: 800, safeTop: 24, safeBottom: 20, fontSize: 17 },
  iphone375: { id: 'iphone375', label: 'iPhone · 375×812', width: 375, height: 812, safeTop: 44, safeBottom: 34, fontSize: 17 },
  iphone390: { id: 'iphone390', label: 'iPhone · 390×844', width: 390, height: 844, safeTop: 47, safeBottom: 34, fontSize: 18 },
  android412: { id: 'android412', label: 'Android XL · 412×915', width: 412, height: 915, safeTop: 28, safeBottom: 22, fontSize: 18 }
};

export function orientedDevice(device, orientation = 'portrait') {
  if (orientation !== 'landscape') return { ...device, orientation };
  return { ...device, width: device.height, height: device.width, safeTop: Math.min(device.safeTop, 24), safeBottom: Math.min(device.safeBottom, 20), orientation };
}

function placeholder(frame) {
  return `<div class="player-placeholder"><div class="player-placeholder-mark">H</div><strong>Изображение не назначено</strong><span>${escapeHtml(frame?.visualPrompt || frame?.sceneTitle || 'Добавьте визуал для этого кадра')}</span></div>`;
}

export function renderPlayerFrame(host, {
  frame,
  device = DEVICE_PRESETS.iphone390,
  orientation = 'portrait',
  assetUrl = null,
  textScale = 1,
  panelStyle = 'glass',
  showStatusBar = true,
  selectedOptionId = null,
  onChoose = null,
  scaleToFit = true,
  bare = false
} = {}) {
  const actualDevice = orientedDevice(device, orientation);
  const visual = visualForDevice(frame?.assignment, actualDevice.id);
  const diagnostics = frameDiagnostics(frame, actualDevice, visual, textScale);
  const scale = scaleToFit ? Math.min(1, 520 / actualDevice.height, 390 / actualDevice.width) : 1;
  const shellWidth = actualDevice.width * scale;
  const shellHeight = actualDevice.height * scale;
  const positionX = Math.round((visual.focalPoint?.x ?? 0.5) * 100);
  const positionY = Math.round((visual.focalPoint?.y ?? 0.5) * 100);
  const background = assetUrl
    ? `<img class="player-image" src="${assetUrl}" alt="" style="object-fit:${visual.fit};object-position:${positionX}% ${positionY}%;transform:scale(${visual.zoom});" />`
    : placeholder(frame);
  const options = frame?.type === 'choice'
    ? `<div class="player-options">${(frame.options || []).map(option => `<button class="player-option ${selectedOptionId === option.id ? 'selected' : ''}" type="button" data-player-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>`).join('')}</div>`
    : '';
  const speaker = frame?.speaker ? `<div class="player-speaker">${escapeHtml(frame.speaker)}</div>` : '';
  const typeClass = frame?.type === 'thought' ? 'thought' : frame?.type === 'narration' ? 'narration' : frame?.type === 'choice' ? 'choice' : 'dialogue';
  const screenMarkup = `<div class="player-screen">
          ${background}
          <div class="player-shade"></div>
          ${showStatusBar ? `<div class="player-status"><span>9:41</span><span>● ● ●</span></div>` : ''}
          <div class="player-scene-label"><span>HEARTLINE</span><strong>${escapeHtml(frame?.sceneTitle || '')}</strong></div>
          <div class="player-dialogue-panel ${panelStyle} ${typeClass}">
            ${speaker}
            <div class="player-current-text">${escapeHtml(frame?.text || '')}</div>
            ${options}
          </div>
        </div>`;
  host.innerHTML = bare
    ? `<div class="player-device runtime-bare ${actualDevice.orientation}" style="width:100%;height:100%;--safe-top:${actualDevice.safeTop}px;--safe-bottom:${actualDevice.safeBottom}px;--frame-font:${Math.round(actualDevice.fontSize * textScale)}px;--overlay:${visual.overlayOpacity};">${screenMarkup}</div>`
    : `<div class="player-device-wrap" style="width:${shellWidth}px;height:${shellHeight}px"><div class="player-device ${actualDevice.orientation}" style="width:${actualDevice.width}px;height:${actualDevice.height}px;transform:scale(${scale});transform-origin:top left;--safe-top:${actualDevice.safeTop}px;--safe-bottom:${actualDevice.safeBottom}px;--frame-font:${Math.round(actualDevice.fontSize * textScale)}px;--overlay:${visual.overlayOpacity};">${screenMarkup}</div></div>`;
  if (onChoose) host.querySelectorAll('[data-player-option]').forEach(button => button.addEventListener('click', () => onChoose(button.dataset.playerOption)));
  return diagnostics;
}

export function renderDeviceComparison(host, configs) {
  host.innerHTML = '<div class="device-comparison-grid"></div>';
  const grid = host.firstElementChild;
  const results = [];
  for (const config of configs) {
    const cell = document.createElement('section');
    cell.className = 'device-comparison-cell';
    const label = document.createElement('header');
    label.innerHTML = `<strong>${escapeHtml(config.device.label)}</strong><span>${config.orientation === 'landscape' ? 'Горизонтально' : 'Вертикально'}</span>`;
    const preview = document.createElement('div');
    preview.className = 'device-comparison-preview';
    cell.append(label, preview);
    grid.append(cell);
    const diagnostics = renderPlayerFrame(preview, { ...config, scaleToFit: true });
    results.push({ device: config.device, diagnostics });
  }
  return results;
}
