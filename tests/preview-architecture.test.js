import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = file => readFile(file, 'utf8');

test('preview renderer contains no device catalog', async () => {
  const renderer = await text('heartline-player-renderer.js');
  assert.doesNotMatch(renderer, /DEVICE_PRESETS/);
  assert.doesNotMatch(renderer, /iphone390|android360|android412/);
});

test('legacy app depends on Application device profile service', async () => {
  const app = await text('heartline-app.js');
  assert.match(app, /getAppServices/);
  assert.match(app, /deviceProfileService/);
  assert.doesNotMatch(app, /DEVICE_PRESETS/);
});

test('device profile infrastructure is constructed only from composition root', async () => {
  const root = await text('hl-editor/bootstrap/composition-root.js');
  assert.match(root, /new DeviceProfileService/);
  assert.match(root, /BUILTIN_DEVICE_PROFILE_CATALOG/);
});

test('preview stylesheet is feature-scoped', async () => {
  const index = await text('index.html');
  assert.match(index, /hl-editor\/preview\/presentation\/preview-lab\.css/);
});
