export const GenericStoryProfile = Object.freeze({
  id: 'generic',
  matches: () => false,
  enrichNovel(novel) {
    novel.storyMetadata ||= {};
    for (const [index, scene] of (novel.scenes || []).entries()) {
      scene.chapterId ||= scene.chapterTitle ? `chapter:${scene.chapterTitle}` : 'chapter:other';
      scene.chapterTitle ||= scene.chapterId === 'chapter:other' ? 'Другие сцены' : scene.chapterId;
      scene.order ??= index;
    }
    return novel;
  },
  initialVariables: content => ({ ...(content?.initialVars || {}) }),
  staticTargets({ raw, sceneIds }) {
    const target = String(raw || '').trim().replace(/[.;]+$/, '').replace(/^GOTO\s+/i, '').trim();
    return target && sceneIds.has(target) ? [target] : [];
  },
  routeKey({ scene, layout }) {
    return String(scene?.routeKey || scene?.editor?.routeHint || layout?.routeHint || 'common').toLowerCase();
  },
  routeLabel: key => key === 'common' ? 'Общая линия' : String(key || 'unclassified'),
  storylineOrder: (_key, index) => index,
  isMainDecision: () => false,
  endingRouteKey({ item, endingId }) { return String(item?.routeKey || endingId || 'common').toLowerCase(); },
  evaluateRoute: () => false,
  executeSystem: () => false,
  resolveGoto({ target }) { return target; }
});
