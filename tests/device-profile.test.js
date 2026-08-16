import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCustomDeviceProfile,
  calculateDeviceScale,
  orientedDeviceProfile
} from '../hl-editor/preview/domain/device-profile.js';
import { DeviceProfileService } from '../hl-editor/preview/application/device-profile-service.js';
import {
  BUILTIN_DEVICE_PROFILE_CATALOG,
  BUILTIN_DEVICE_COMPARISON_PRESETS,
  DEFAULT_PREVIEW_DEVICE_ID
} from '../hl-editor/preview/infrastructure/builtin-device-profile-catalog.js';

const service = new DeviceProfileService(BUILTIN_DEVICE_PROFILE_CATALOG, {
  defaultId: DEFAULT_PREVIEW_DEVICE_ID,
  comparisonPresets: BUILTIN_DEVICE_COMPARISON_PRESETS,
  maxComparisonDevices: 4
});

test('catalog has representative iOS, Android and foldable viewports', () => {
  const families = new Set(service.list().map(profile => profile.family));
  assert.ok(families.has('iOS'));
  assert.ok(families.has('Android'));
  assert.ok(families.has('Foldable'));
  assert.ok(service.list().length >= 8);
});

test('default profile is supplied by configuration', () => {
  assert.equal(service.defaultProfile().id, DEFAULT_PREVIEW_DEVICE_ID);
});

test('comparison is capped and duplicate-free', () => {
  const ids = service.normalizeComparison([
    'ios-standard','ios-standard','ios-max','android-compact','android-standard','fold-inner'
  ]);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, ids.length);
});

test('custom viewport is validated and normalized', () => {
  const custom = createCustomDeviceProfile({
    width: 444, height: 900, safeTop: 30, safeBottom: 20, safeLeft: 4, safeRight: 4
  });
  assert.equal(custom.id, 'custom');
  assert.equal(custom.width, 444);
  assert.equal(custom.safeAreas.portrait.top, 30);
});

test('landscape uses explicit/rotated safe-area geometry', () => {
  const portrait = service.get('ios-standard');
  const landscape = orientedDeviceProfile(portrait, 'landscape');
  assert.equal(landscape.width, portrait.height);
  assert.equal(landscape.height, portrait.width);
  assert.ok(Number.isFinite(landscape.safeLeft));
  assert.ok(Number.isFinite(landscape.safeRight));
});

test('fit scale responds to available stage size without renderer constants', () => {
  const device = service.get('ios-standard');
  const small = calculateDeviceScale(device, 'portrait', { availableWidth: 500, availableHeight: 500, mode: 'fit' });
  const large = calculateDeviceScale(device, 'portrait', { availableWidth: 1200, availableHeight: 1000, mode: 'fit' });
  assert.ok(large > small);
  assert.equal(calculateDeviceScale(device, 'portrait', { mode: '0.75' }), 0.75);
});
