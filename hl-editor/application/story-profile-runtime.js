const genericProfile = Object.freeze({
  id: 'generic',
  matches: () => false,
  enrichNovel: novel => novel,
  initialVariables: content => ({ ...(content?.initialVars || {}) }),
  staticTargets: ({ raw, sceneIds }) => {
    const target = String(raw || '').trim().replace(/[.;]+$/, '').replace(/^GOTO\s+/i, '').trim();
    return target && sceneIds?.has?.(target) ? [target] : [];
  },
  routeKey: ({ scene, layout }) => String(scene?.routeKey || scene?.editor?.routeHint || layout?.routeHint || 'common').toLowerCase(),
  routeLabel: key => key === 'common' ? 'Общая линия' : String(key || 'unclassified'),
  storylineOrder: (_key, index) => index,
  isMainDecision: () => false,
  endingRouteKey: ({ item, endingId }) => String(item?.routeKey || endingId || 'common').toLowerCase(),
  evaluateRoute: () => false,
  executeSystem: () => false,
  resolveGoto: ({ target }) => target
});

let resolver = () => genericProfile;

export function setStoryProfileResolver(nextResolver) {
  resolver = typeof nextResolver === 'function' ? nextResolver : () => genericProfile;
}

export function resolveStoryProfile(content) {
  try { return resolver(content) || genericProfile; }
  catch (_) { return genericProfile; }
}

export { genericProfile };
