import { createCustomDeviceProfile, normalizeDeviceProfile } from '../domain/device-profile.js';

export class DeviceProfileService {
  constructor(catalog, {
    defaultId,
    comparisonPresets = {},
    maxComparisonDevices = 4
  } = {}) {
    const profiles = Array.from(catalog || []).map(normalizeDeviceProfile);
    if (!profiles.length) throw new TypeError('Device profile catalog is empty');

    this.profiles = Object.freeze(profiles);
    this.byId = new Map(profiles.map(profile => [profile.id, profile]));
    this.defaultId = this.byId.has(defaultId) ? defaultId : profiles[0].id;
    this.maxComparisonDevices = Math.max(2, Number(maxComparisonDevices) || 4);
    this.comparisonPresets = Object.freeze(Object.fromEntries(
      Object.entries(comparisonPresets).map(([key, ids]) => [
        key,
        Object.freeze(Array.from(ids || []).filter(id => this.byId.has(id)).slice(0, this.maxComparisonDevices))
      ])
    ));
  }

  list() { return [...this.profiles]; }

  get(id) { return this.byId.get(id) || null; }

  defaultProfile() { return this.byId.get(this.defaultId); }

  groupedProfiles() {
    const groups = new Map();
    for (const profile of this.profiles) {
      if (!groups.has(profile.family)) groups.set(profile.family, []);
      groups.get(profile.family).push(profile);
    }
    return [...groups].map(([family, profiles]) => ({ family, profiles }));
  }

  comparisonPreset(id = 'essential') {
    const ids = this.comparisonPresets[id] || this.comparisonPresets.essential || [this.defaultId];
    return ids.map(profileId => this.byId.get(profileId)).filter(Boolean);
  }

  normalizeComparison(ids) {
    const unique = [...new Set(Array.from(ids || []).filter(id => this.byId.has(id)))];
    const fallback = this.comparisonPreset('essential').map(profile => profile.id);
    return (unique.length ? unique : fallback).slice(0, this.maxComparisonDevices);
  }

  createCustom(input) { return createCustomDeviceProfile(input); }

  resolve(id, customInput = null) {
    if (id === 'custom') return this.createCustom(customInput || {});
    return this.get(id) || this.defaultProfile();
  }
}
