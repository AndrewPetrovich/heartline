export const DEFAULT_PREVIEW_DEVICE_ID = 'ios-standard';

export const BUILTIN_DEVICE_PROFILE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'ios-compact',
    label: 'iPhone Compact · 375×667',
    family: 'iOS',
    width: 375, height: 667, fontSize: 16,
    safeAreas: { portrait: { top: 20, right: 0, bottom: 0, left: 0 }, landscape: { top: 0, right: 20, bottom: 0, left: 20 } },
    cutout: 'none',
    aliases: ['compact iPhone class'],
    tags: ['ios', 'compact', 'edge']
  }),
  Object.freeze({
    id: 'ios-standard',
    label: 'iPhone Standard · 390×844',
    family: 'iOS',
    width: 390, height: 844, fontSize: 18,
    safeAreas: { portrait: { top: 47, right: 0, bottom: 34, left: 0 }, landscape: { top: 0, right: 47, bottom: 21, left: 47 } },
    cutout: 'island',
    aliases: ['standard iPhone class'],
    tags: ['ios', 'popular']
  }),
  Object.freeze({
    id: 'ios-pro',
    label: 'iPhone Pro · 393×852',
    family: 'iOS',
    width: 393, height: 852, fontSize: 18,
    safeAreas: { portrait: { top: 59, right: 0, bottom: 34, left: 0 }, landscape: { top: 0, right: 59, bottom: 21, left: 59 } },
    cutout: 'island',
    aliases: ['Pro-class iPhone'],
    tags: ['ios', 'popular']
  }),
  Object.freeze({
    id: 'ios-max',
    label: 'iPhone Max · 430×932',
    family: 'iOS',
    width: 430, height: 932, fontSize: 18,
    safeAreas: { portrait: { top: 59, right: 0, bottom: 34, left: 0 }, landscape: { top: 0, right: 59, bottom: 21, left: 59 } },
    cutout: 'island',
    aliases: ['large iPhone class'],
    tags: ['ios', 'large', 'popular']
  }),
  Object.freeze({
    id: 'android-compact',
    label: 'Android Compact · 360×800',
    family: 'Android',
    width: 360, height: 800, fontSize: 17,
    safeAreas: { portrait: { top: 24, right: 0, bottom: 20, left: 0 }, landscape: { top: 0, right: 24, bottom: 16, left: 24 } },
    cutout: 'punch-hole',
    aliases: ['compact Android class'],
    tags: ['android', 'compact', 'popular']
  }),
  Object.freeze({
    id: 'android-standard',
    label: 'Android Standard · 412×915',
    family: 'Android',
    width: 412, height: 915, fontSize: 18,
    safeAreas: { portrait: { top: 28, right: 0, bottom: 24, left: 0 }, landscape: { top: 0, right: 28, bottom: 18, left: 28 } },
    cutout: 'punch-hole',
    aliases: ['Galaxy S / Pixel class'],
    tags: ['android', 'popular']
  }),
  Object.freeze({
    id: 'android-large',
    label: 'Android Large / Ultra · 432×960',
    family: 'Android',
    width: 432, height: 960, fontSize: 18,
    safeAreas: { portrait: { top: 30, right: 0, bottom: 24, left: 0 }, landscape: { top: 0, right: 30, bottom: 18, left: 30 } },
    cutout: 'punch-hole',
    aliases: ['large Android / Ultra class'],
    tags: ['android', 'large', 'edge']
  }),
  Object.freeze({
    id: 'fold-outer',
    label: 'Foldable · внешний · 412×1000',
    family: 'Foldable',
    width: 412, height: 1000, fontSize: 18,
    safeAreas: { portrait: { top: 28, right: 0, bottom: 24, left: 0 }, landscape: { top: 0, right: 28, bottom: 18, left: 28 } },
    cutout: 'punch-hole',
    aliases: ['foldable cover display'],
    tags: ['foldable', 'outer', 'edge']
  }),
  Object.freeze({
    id: 'fold-inner',
    label: 'Foldable · внутренний · 673×841',
    family: 'Foldable',
    width: 673, height: 841, fontSize: 18,
    safeAreas: { portrait: { top: 24, right: 12, bottom: 24, left: 12 }, landscape: { top: 12, right: 24, bottom: 12, left: 24 } },
    cutout: 'none',
    hinge: { axis: 'vertical', size: 16, position: 0.5 },
    aliases: ['foldable inner display'],
    tags: ['foldable', 'inner', 'large', 'edge']
  })
]);

export const BUILTIN_DEVICE_COMPARISON_PRESETS = Object.freeze({
  essential: Object.freeze(['ios-standard', 'ios-max', 'android-compact', 'android-standard']),
  ios: Object.freeze(['ios-compact', 'ios-standard', 'ios-pro', 'ios-max']),
  android: Object.freeze(['android-compact', 'android-standard', 'android-large', 'fold-outer']),
  edge: Object.freeze(['ios-compact', 'android-large', 'fold-outer', 'fold-inner'])
});
