import { readFile } from 'node:fs/promises';

const read = file => readFile(file, 'utf8');

const [app, renderer, composition, index, catalog, service] = await Promise.all([
  read('heartline-app.js'),
  read('heartline-player-renderer.js'),
  read('hl-editor/bootstrap/composition-root.js'),
  read('index.html'),
  read('hl-editor/preview/infrastructure/builtin-device-profile-catalog.js'),
  read('hl-editor/preview/application/device-profile-service.js')
]);

const errors = [];

if (/DEVICE_PRESETS/.test(app) || /DEVICE_PRESETS/.test(renderer)) {
  errors.push('Legacy DEVICE_PRESETS must not exist in Preview Presentation/renderer.');
}
for (const legacyId of ['iphone390', 'iphone375', 'android360', 'android412']) {
  if (app.includes(legacyId) || renderer.includes(legacyId)) {
    errors.push(`Legacy device id ${legacyId} leaked into generic Preview code.`);
  }
}
if (!app.includes('deviceProfileService')) {
  errors.push('heartline-app.js must obtain viewport profiles from DeviceProfileService.');
}
if (!composition.includes('new DeviceProfileService')) {
  errors.push('Composition root must construct DeviceProfileService.');
}
if (!composition.includes('BUILTIN_DEVICE_PROFILE_CATALOG')) {
  errors.push('Composition root must inject the built-in profile catalog.');
}
if (!index.includes('hl-editor/preview/presentation/preview-lab.css')) {
  errors.push('Preview Lab stylesheet is not wired in index.html.');
}
if (!catalog.includes('ios-standard') || !catalog.includes('android-standard') || !catalog.includes('fold-inner')) {
  errors.push('Representative iOS, Android and Foldable profiles are missing.');
}
if (/\bdocument\b|\bwindow\b|querySelector|MutationObserver/.test(service)) {
  errors.push('DeviceProfileService must remain DOM-free.');
}
if (/390\s*[,x×]\s*844/.test(renderer)) {
  errors.push('Viewport dimensions must not be hardcoded in the renderer.');
}

if (errors.length) {
  console.error('Preview architecture: FAIL');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('Preview architecture: PASS');
