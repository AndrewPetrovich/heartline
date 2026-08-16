import { assertStoryFormatProfile } from '../ports/story-format-profile.js';
import { genericProfile } from './story-profile-runtime.js';

export class StoryProfileRegistry {
  constructor(profiles = []) {
    this.profiles = new Map([[genericProfile.id, genericProfile]]);
    for (const profile of profiles) this.register(profile);
  }

  register(profile) {
    const value = assertStoryFormatProfile(profile);
    this.profiles.set(value.id, value);
    return value;
  }

  resolve(content) {
    const explicit = String(content?.storyMetadata?.profile || content?.storyProfile || '').trim();
    if (explicit && this.profiles.has(explicit)) return this.profiles.get(explicit);
    for (const profile of this.profiles.values()) {
      if (profile.id === genericProfile.id) continue;
      try { if (profile.matches(content)) return profile; } catch (_) {}
    }
    return genericProfile;
  }

  list() { return [...this.profiles.values()]; }
}
