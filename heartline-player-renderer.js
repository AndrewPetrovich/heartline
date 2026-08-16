import { escapeHtml, frameDiagnostics, visualForDevice } from './heartline-domain.js';
import { calculateDeviceScale, orientedDeviceProfile } from './hl-editor/preview/domain/device-profile.js';

export function orientedDevice(device, orientation = 'portrait') {
  return orientedDeviceProfile(device, orientation);
}

export function calculatePreviewScale(device, orientation = 'portrait', options = {}) {
  return calculateDeviceScale(device, orientation, options);
}

function placeholder(frame) {
  return `<div class="player-placeholder"><div class="player-placeholder-mark">H</div><strong>Изображение не назначено</strong><span>${escapeHtml(frame?.visualPrompt || frame?.sceneTitle || 'Добавьте визуал для этого кадра')}</span></div>`;
}

function safeAreaMarkup(device) {
  const hinge = device.hinge
    ? `<span class="player-hinge" data-axis="${escapeHtml(device.hinge.axis)}" style="--hinge-position:${Number(device.hinge.position || .5)};--hinge-size:${Number(device.hinge.size || 0)}px"></span>`
    : '';
  const cutout = device.cutout && device.cutout !== 'none'
    ? `<span class="player-cutout" data-cutout="${escapeHtml(device.cutout)}"></span>`
    : '';
  return `<div class="player-safe-overlay" aria-hidden="true"><span class="player-safe-boundary"></span>${cutout}${hinge}</div>`;
}

function addWarning(diagnostics, warning) {
  if (diagnostics.warnings.some(item => item.code === warning.code)) return;
  diagnostics.warnings.push(warning);
  if (warning.level === 'error') diagnostics.ok = false;
}

function enrichRenderedDiagnostics(host, diagnostics, device, scale) {
  const screen = host.querySelector('.player-screen');
  const panel = host.querySelector('.player-dialogue-panel');
  if (!screen || !panel) return diagnostics;

  const screenRect = screen.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const actualScale = Math.max(.01, Number(scale) || 1);
  const panelTop = (panelRect.top - screenRect.top) / actualScale;
  const safeTop = Number(device.safeTop || 0);

  if (panelTop < safeTop + 8) {
    addWarning(diagnostics, {
      code: 'safe-area-overlap',
      level: 'error',
      text: 'Текстовая панель заходит в верхнюю safe area.'
    });
  }

  const text = host.querySelector('.player-current-text');
  if (text && (text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1)) {
    addWarning(diagnostics, {
      code: 'text-overflow',
      level: 'error',
      text: 'Текст выходит за доступную область панели.'
    });
  }

  const tooSmallChoice = [...host.querySelectorAll('.player-option')].some(option => {
    const rect = option.getBoundingClientRect();
    return rect.height / actualScale < 44;
  });
  if (tooSmallChoice) {
    addWarning(diagnostics, {
      code: 'touch-target',
      level: 'warning',
      text: 'Высота одного из вариантов выбора меньше рекомендуемой touch-area.'
    });
  }

  return diagnostics;
}

function bindFocalInteraction(host, {
  onFocalPointChange = null,
  onZoomChange = null,
  currentZoom = 1
} = {}) {
  const screen = host.querySelector('.player-screen');
  const marker = host.querySelector('.player-focal-handle');
  const image = host.querySelector('.player-image');
  if (!screen || !marker || !onFocalPointChange) return;

  let dragging = false;
  const applyPoint = (event, commit = false) => {
    const rect = screen.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
    marker.style.left = `${Math.round(x * 10000) / 100}%`;
    marker.style.top = `${Math.round(y * 10000) / 100}%`;
    if (image) image.style.objectPosition = `${Math.round(x * 100)}% ${Math.round(y * 100)}%`;
    onFocalPointChange({ x, y }, { commit });
  };

  screen.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest?.('.player-dialogue-panel,button')) return;
    dragging = true;
    screen.setPointerCapture?.(event.pointerId);
    applyPoint(event, false);
  });
  screen.addEventListener('pointermove', event => {
    if (dragging) applyPoint(event, false);
  });
  screen.addEventListener('pointerup', event => {
    if (!dragging) return;
    dragging = false;
    applyPoint(event, true);
    screen.releasePointerCapture?.(event.pointerId);
  });
  screen.addEventListener('pointercancel', () => { dragging = false; });

  if (onZoomChange) {
    screen.addEventListener('wheel', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -.04 : .04;
      const next = Math.max(1, Math.min(2.2, Number(currentZoom || 1) + delta));
      onZoomChange(next, { commit: true });
    }, { passive: false });
  }
}

export function renderPlayerFrame(host, {
  frame,
  device,
  orientation = 'portrait',
  assetUrl = null,
  textScale = 1,
  panelStyle = 'glass',
  showStatusBar = true,
  selectedOptionId = null,
  onChoose = null,
  scaleToFit = true,
  scale = null,
  fitBounds = null,
  scaleMode = 'fit',
  bare = false,
  showSafeArea = false,
  showFocalPoint = false,
  onFocalPointChange = null,
  onZoomChange = null
} = {}) {
  if (!device) throw new TypeError('renderPlayerFrame requires a device profile');
  const actualDevice = orientedDevice(device, orientation);
  const visual = visualForDevice(frame?.assignment, device.id);
  const diagnostics = frameDiagnostics(frame, actualDevice, visual, textScale);

  const legacyBounds = { availableWidth: 390, availableHeight: 520, fitFraction: 1, maxScale: 1 };
  const resolvedScale = bare ? 1 : (Number.isFinite(Number(scale))
    ? Number(scale)
    : calculatePreviewScale(device, orientation, fitBounds || (scaleToFit ? legacyBounds : {
      mode: '1',
      availableWidth: actualDevice.width,
      availableHeight: actualDevice.height
    })));
  const shellWidth = actualDevice.width * resolvedScale;
  const shellHeight = actualDevice.height * resolvedScale;
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
  const focal = showFocalPoint
    ? `<span class="player-focal-handle" aria-hidden="true" style="left:${positionX}%;top:${positionY}%"></span>`
    : '';
  const safe = showSafeArea ? safeAreaMarkup(actualDevice) : '';

  const screenMarkup = `<div class="player-screen">
          ${background}
          <div class="player-shade"></div>
          ${safe}
          ${focal}
          ${showStatusBar ? `<div class="player-status"><span>9:41</span><span>● ● ●</span></div>` : ''}
          <div class="player-scene-label"><span>HEARTLINE</span><strong>${escapeHtml(frame?.sceneTitle || '')}</strong></div>
          <div class="player-dialogue-panel ${panelStyle} ${typeClass}">
            ${speaker}
            <div class="player-current-text">${escapeHtml(frame?.text || '')}</div>
            ${options}
          </div>
        </div>`;

  const styleVars = `--safe-top:${actualDevice.safeTop}px;--safe-right:${actualDevice.safeRight}px;--safe-bottom:${actualDevice.safeBottom}px;--safe-left:${actualDevice.safeLeft}px;--frame-font:${Math.round(actualDevice.fontSize * textScale)}px;--overlay:${visual.overlayOpacity};`;
  host.innerHTML = bare
    ? `<div class="player-device runtime-bare ${actualDevice.orientation}" data-device-id="${escapeHtml(device.id)}" style="width:100%;height:100%;${styleVars}">${screenMarkup}</div>`
    : `<div class="player-device-wrap" style="width:${shellWidth}px;height:${shellHeight}px"><div class="player-device ${actualDevice.orientation}" data-device-id="${escapeHtml(device.id)}" style="width:${actualDevice.width}px;height:${actualDevice.height}px;transform:scale(${resolvedScale});transform-origin:top left;${styleVars}">${screenMarkup}</div></div>`;

  if (onChoose) {
    host.querySelectorAll('[data-player-option]').forEach(button => button.addEventListener('click', () => onChoose(button.dataset.playerOption)));
  }
  bindFocalInteraction(host, {
    onFocalPointChange,
    onZoomChange,
    currentZoom: visual.zoom
  });
  enrichRenderedDiagnostics(host, diagnostics, actualDevice, bare ? 1 : resolvedScale);
  diagnostics.scale = resolvedScale;
  diagnostics.device = actualDevice;
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
    const diagnostics = renderPlayerFrame(preview, { ...config, scaleToFit: false });
    results.push({ device: config.device, diagnostics });
  }
  return results;
}
