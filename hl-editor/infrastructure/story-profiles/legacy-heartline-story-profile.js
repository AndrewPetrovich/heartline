const ROUTE_LABELS = Object.freeze({
  common: 'Общая линия', equal: 'На равных', fire: 'Игра с огнём', mask: 'Без масок', direct: 'Прямой маршрут',
  oath: 'Финал A', network: 'Финал B', break: 'Финал C', conditional: 'Условные фрагменты', unclassified: 'Не классифицировано'
});
const STORYLINE_ORDER = Object.freeze(['common', 'equal', 'fire', 'mask', 'direct', 'conditional', 'oath', 'network', 'break', 'unclassified']);
const INITIAL_VARIABLES = Object.freeze({ HONESTY: 0, ATTRACTION: 0, TRUST: 0, PROFESSIONAL_COST: 0 });

function walkSteps(steps, visitor) {
  for (const step of steps || []) {
    visitor(step);
    if (step?.type === 'choice') for (const option of step.options || []) walkSteps(option.steps || [], visitor);
  }
}

function hasLegacyRuntimeMarkers(content) {
  const ids = new Set((content?.scenes || []).map(scene => String(scene.id || '').toUpperCase()));
  if ([...ids].some(id => /_(?:EQUAL|FIRE|MASK|DIRECT)(?:_|$)/.test(id))) return true;
  let matched = false;
  for (const scene of content?.scenes || []) walkSteps(scene.steps || [], step => {
    const value = String(step?.value || '');
    if (/соответствующая маршрутная сцена|согласно\s+ROUTE_ID|Сравнить\s+HONESTY/i.test(value)) matched = true;
  });
  return matched;
}

function chapterForScene(scene) {
  if (scene.chapterId) return { chapterId: scene.chapterId, chapterTitle: scene.chapterTitle || scene.chapterId };
  const id = String(scene.id || '');
  const chapter = id.match(/^CH(\d+)/i);
  if (chapter) return { chapterId: `CH${chapter[1]}`, chapterTitle: `Глава ${Number(chapter[1])}` };
  if (/^OB_/i.test(id)) return { chapterId: 'OB', chapterTitle: 'Пролог' };
  if (/^CLIM_/i.test(id)) return { chapterId: 'CLIM', chapterTitle: 'Кульминация' };
  if (/^AM_/i.test(id)) return { chapterId: 'AM', chapterTitle: 'Утро' };
  if (/^EP_/i.test(id)) return { chapterId: 'EP', chapterTitle: 'Эпилог' };
  return { chapterId: 'OTHER', chapterTitle: 'Другие сцены' };
}

function routeKeyFromScene(scene, layout = null) {
  const explicit = String(scene?.routeKey || scene?.editor?.routeHint || layout?.routeHint || '').toLowerCase();
  if (explicit) return explicit;
  if (scene?.finalRoute === 'A') return 'oath';
  if (scene?.finalRoute === 'B') return 'network';
  if (scene?.finalRoute === 'C') return 'break';
  const id = String(scene?.id || '').toUpperCase();
  for (const key of ['equal', 'fire', 'mask', 'direct']) if (new RegExp(`(?:^|_)${key}(?:_|$)`, 'i').test(id)) return key;
  return 'common';
}

export const LegacyHeartlineStoryProfile = Object.freeze({
  id: 'heartline-legacy-routes-v1',
  matches(content) {
    if (content?.storyMetadata?.profile === this.id || content?.storyProfile === this.id) return true;
    return hasLegacyRuntimeMarkers(content);
  },
  enrichNovel(novel) {
    if (!this.matches(novel)) return novel;
    novel.storyMetadata ||= {};
    novel.storyMetadata.profile ||= this.id;
    novel.storyMetadata.routeLabels = { ...ROUTE_LABELS, ...(novel.storyMetadata.routeLabels || {}) };
    novel.storyMetadata.storylineOrder ||= [...STORYLINE_ORDER];
    for (const [index, scene] of (novel.scenes || []).entries()) {
      const chapter = chapterForScene(scene);
      scene.chapterId ||= chapter.chapterId;
      scene.chapterTitle ||= chapter.chapterTitle;
      scene.order ??= index;
      scene.routeKey ||= routeKeyFromScene(scene);
    }
    return novel;
  },
  initialVariables(content) { return { ...INITIAL_VARIABLES, ...(content?.initialVars || {}) }; },
  staticTargets({ raw, sceneIds }) {
    const target = String(raw || '').trim().replace(/[.;]+$/, '').replace(/^GOTO\s+/i, '').trim();
    if (sceneIds.has(target)) return [target];
    if (/соответствующая маршрутная сцена/i.test(target)) return ['CH03_SC03_EQUAL', 'CH03_SC03_FIRE', 'CH03_SC03_MASK'].filter(id => sceneIds.has(id));
    if (/согласно\s+ROUTE_ID/i.test(target)) return ['CH06_SC04_DIRECT', 'CH06_SC05_EQUAL', 'CH06_SC05_FIRE', 'CH06_SC05_MASK'].filter(id => sceneIds.has(id));
    return [];
  },
  routeKey({ scene, layout }) { return routeKeyFromScene(scene, layout); },
  routeLabel(key) { return ROUTE_LABELS[key] || String(key || 'unclassified'); },
  storylineOrder(key, fallbackIndex = 0) {
    const index = STORYLINE_ORDER.indexOf(key);
    return index >= 0 ? index : STORYLINE_ORDER.length + fallbackIndex;
  },
  isMainDecision(choiceId) { return /^C(?:0[1-9]|1\d|2[0-2])$/i.test(String(choiceId || '')); },
  endingRouteKey({ item, endingId }) {
    if (item?.routeKey) return String(item.routeKey).toLowerCase();
    return ({ A: 'oath', B: 'network', C: 'break' })[String(endingId || '').toUpperCase()] || 'common';
  },
  evaluateRoute({ get, set }) {
    const scores = [
      ['ROUTE_EQUAL', Number(get('HONESTY') || 0)], ['ROUTE_FIRE', Number(get('ATTRACTION') || 0)], ['ROUTE_MASK', Number(get('TRUST') || 0)]
    ].sort((left, right) => right[1] - left[1]);
    if (scores[0][1] - scores[1][1] >= 2 && scores.filter(item => item[1] === scores[0][1]).length === 1) {
      set('ROUTE_ID', scores[0][0]); set('DIRECT_ROUTE_CHOICE', false);
    } else { set('ROUTE_ID', ''); set('DIRECT_ROUTE_CHOICE', true); }
    return true;
  },
  executeSystem({ source, get, set, applySet, end }) {
    if (/^Сравнить\s+HONESTY/i.test(source)) {
      this.evaluateRoute({ get, set });
      return true;
    }
    if (/^FLAG_[A-Z0-9_]+\s*=/i.test(source)) {
      for (const part of source.split(';')) applySet(part.trim());
      return true;
    }
    if (/^END\s+ROUTE_/i.test(source)) {
      const route = (source.match(/ROUTE_[A-Z]+/i) || [''])[0].replace('ROUTE_', '');
      end(`Конец маршрута ${route}.`);
      return true;
    }
    return false;
  },
  resolveGoto({ target, get, hasScene }) {
    if (/соответствующая маршрутная сцена/i.test(target)) {
      const map = [['FLAG_PACT_EQUAL','CH03_SC03_EQUAL'], ['FLAG_PACT_FIRE','CH03_SC03_FIRE'], ['FLAG_PACT_MASK','CH03_SC03_MASK']];
      return map.find(([flag, scene]) => Boolean(get(flag)) && hasScene(scene))?.[1] || map.find(([, scene]) => hasScene(scene))?.[1] || target;
    }
    if (/согласно\s+ROUTE_ID/i.test(target)) {
      const routes = { ROUTE_EQUAL: 'CH06_SC05_EQUAL', ROUTE_FIRE: 'CH06_SC05_FIRE', ROUTE_MASK: 'CH06_SC05_MASK' };
      const resolved = routes[String(get('ROUTE_ID') || '')] || 'CH06_SC04_DIRECT';
      return hasScene(resolved) ? resolved : target;
    }
    return target;
  }
});
