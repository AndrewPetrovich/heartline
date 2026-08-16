export function assertStoryFormatProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new TypeError('StoryFormatProfile is required');
  if (!profile.id || typeof profile.id !== 'string') throw new TypeError('StoryFormatProfile.id is required');
  for (const method of ['matches', 'enrichNovel', 'initialVariables', 'staticTargets', 'routeKey', 'routeLabel', 'endingRouteKey']) {
    if (typeof profile[method] !== 'function') throw new TypeError(`StoryFormatProfile.${method} is required`);
  }
  return profile;
}
