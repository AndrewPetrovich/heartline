import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryProfileRegistry } from '../hl-editor/application/story-profile-registry.js';
import { GenericStoryProfile } from '../hl-editor/infrastructure/story-profiles/generic-story-profile.js';
import { LegacyHeartlineStoryProfile } from '../hl-editor/infrastructure/story-profiles/legacy-heartline-story-profile.js';

const registry = new StoryProfileRegistry([GenericStoryProfile, LegacyHeartlineStoryProfile]);

test('legacy story rules are selected by the profile, not generic engine code', () => {
  const content = { scenes: [{ id: 'CH03_SC03_EQUAL', steps: [] }] };
  assert.equal(registry.resolve(content).id, LegacyHeartlineStoryProfile.id);
});

test('legacy profile enriches chapter and route metadata', () => {
  const novel = { scenes: [{ id: 'CH02_SC01', steps: [] }, { id: 'CH03_SC03_FIRE', steps: [] }] };
  const result = LegacyHeartlineStoryProfile.enrichNovel(novel);
  assert.equal(result.scenes[0].chapterTitle, 'Глава 2');
  assert.equal(result.scenes[1].routeKey, 'fire');
  assert.equal(result.storyMetadata.profile, LegacyHeartlineStoryProfile.id);
});

test('dynamic route targets are isolated in the legacy profile', () => {
  const ids = new Set(['CH03_SC03_EQUAL','CH03_SC03_FIRE','CH03_SC03_MASK']);
  assert.deepEqual(LegacyHeartlineStoryProfile.staticTargets({ raw: 'соответствующая маршрутная сцена', sceneIds: ids }), [...ids]);
});

test('legacy route evaluation is data-profile behavior', () => {
  const vars = { HONESTY: 5, ATTRACTION: 1, TRUST: 1 };
  LegacyHeartlineStoryProfile.evaluateRoute({ get: key => vars[key], set: (key, value) => { vars[key] = value; } });
  assert.equal(vars.ROUTE_ID, 'ROUTE_EQUAL');
  assert.equal(vars.DIRECT_ROUTE_CHOICE, false);
});

test('generic profile has no novel-specific variables or routes', () => {
  assert.deepEqual(GenericStoryProfile.initialVariables({}), {});
  assert.equal(GenericStoryProfile.routeKey({ scene: {}, layout: null }), 'common');
});
