import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('heartline-app.js', 'utf8');

test('runtime export closes StoryProfile dependencies', () => {
  assert.match(app, /fetch\('\.\/hl-editor\/application\/story-profile-runtime\.js'\)/);
  assert.match(app, /fetch\('\.\/hl-editor\/infrastructure\/story-profiles\/generic-story-profile\.js'\)/);
  assert.match(app, /fetch\('\.\/hl-editor\/infrastructure\/story-profiles\/legacy-heartline-story-profile\.js'\)/);
  assert.match(app, /story-profile-runtime\.js/);
  assert.match(app, /LegacyHeartlineStoryProfile\.matches/);
});

test('runtime export closes Preview device-profile dependency', () => {
  assert.match(app, /fetch\('\.\/hl-editor\/preview\/domain\/device-profile\.js'\)/);
  assert.match(app, /\.replace\("\.\/hl-editor\/preview\/domain\/device-profile\.js", "\.\/device-profile\.js"\)/);
  assert.match(app, /\{ name: 'device-profile\.js', data: deviceProfileSource \}/);
});

test('runtime rewrites root application module imports to runtime-local names', () => {
  assert.match(app, /\.replace\("\.\/heartline-domain\.js", "\.\/domain\.js"\)/);
  assert.match(app, /\.replace\("\.\/hl-editor\/application\/story-profile-runtime\.js", "\.\/story-profile-runtime\.js"\)/);
});
