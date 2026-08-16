export const DEVICE_ORIENTATIONS = Object.freeze(['portrait', 'landscape']);

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function normalizeInsets(value = {}) {
  return Object.freeze({
    top: clamp(value.top, 0, 240),
    right: clamp(value.right, 0, 240),
    bottom: clamp(value.bottom, 0, 240),
    left: clamp(value.left, 0, 240)
  });
}

function rotateInsetsClockwise(insets) {
  return Object.freeze({
    top: insets.left,
    right: insets.top,
    bottom: insets.right,
    left: insets.bottom
  });
}

export function normalizeDeviceProfile(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Device profile is required');
  const id = String(input.id || '').trim();
  const label = String(input.label || id).trim();
  const width = Math.round(clamp(input.width, 240, 2200));
  const height = Math.round(clamp(input.height, 320, 2400));
  if (!id) throw new TypeError('Device profile id is required');
  if (!label) throw new TypeError(`Device profile ${id} label is required`);

  const portrait = normalizeInsets(input.safeAreas?.portrait || {
    top: input.safeTop,
    right: input.safeRight,
    bottom: input.safeBottom,
    left: input.safeLeft
  });
  const landscape = normalizeInsets(input.safeAreas?.landscape || rotateInsetsClockwise(portrait));

  return Object.freeze({
    id,
    label,
    family: String(input.family || 'Other'),
    width,
    height,
    fontSize: Math.round(clamp(input.fontSize || 17, 12, 30)),
    safeAreas: Object.freeze({ portrait, landscape }),
    cutout: String(input.cutout || 'none'),
    aliases: Object.freeze([...(input.aliases || [])].map(String)),
    tags: Object.freeze([...(input.tags || [])].map(String)),
    hinge: input.hinge ? Object.freeze({
      axis: input.hinge.axis === 'horizontal' ? 'horizontal' : 'vertical',
      size: Math.round(clamp(input.hinge.size, 0, 80)),
      position: clamp(input.hinge.position ?? 0.5, 0, 1)
    }) : null
  });
}

export function orientedDeviceProfile(profile, orientation = 'portrait') {
  const source = normalizeDeviceProfile(profile);
  const normalizedOrientation = orientation === 'landscape' ? 'landscape' : 'portrait';
  const insets = source.safeAreas[normalizedOrientation];
  const landscape = normalizedOrientation === 'landscape';

  return Object.freeze({
    ...source,
    width: landscape ? source.height : source.width,
    height: landscape ? source.width : source.height,
    safeTop: insets.top,
    safeRight: insets.right,
    safeBottom: insets.bottom,
    safeLeft: insets.left,
    orientation: normalizedOrientation
  });
}

export function createCustomDeviceProfile(input = {}) {
  return normalizeDeviceProfile({
    id: 'custom',
    label: input.label || `Пользовательский · ${Math.round(Number(input.width) || 390)}×${Math.round(Number(input.height) || 844)}`,
    family: 'Пользовательский',
    width: input.width || 390,
    height: input.height || 844,
    fontSize: input.fontSize || 17,
    safeAreas: {
      portrait: {
        top: input.safeTop || 0,
        right: input.safeRight || 0,
        bottom: input.safeBottom || 0,
        left: input.safeLeft || 0
      }
    },
    cutout: input.cutout || 'none',
    tags: ['custom']
  });
}

export function calculateDeviceScale(profile, orientation, {
  mode = 'fit',
  availableWidth = 900,
  availableHeight = 760,
  fitFraction = 0.84,
  maxScale = 1.25,
  minScale = 0.25
} = {}) {
  const device = orientedDeviceProfile(profile, orientation);
  if (mode !== 'fit') {
    const fixed = Number(mode);
    if (Number.isFinite(fixed) && fixed > 0) return clamp(fixed, minScale, maxScale);
  }

  const widthLimit = Math.max(120, Number(availableWidth) || 900) * fitFraction;
  const heightLimit = Math.max(160, Number(availableHeight) || 760) * fitFraction;
  return clamp(Math.min(widthLimit / device.width, heightLimit / device.height), minScale, maxScale);
}
