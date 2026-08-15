import { sceneFrameMetrics } from './heartline-domain.js';

const ROUTE_LABELS = {
  common: 'Общая линия',
  equal: 'На равных',
  fire: 'Игра с огнём',
  mask: 'Без масок',
  direct: 'Прямой маршрут',
  oath: 'Финал A',
  network: 'Финал B',
  break: 'Финал C',
  conditional: 'Условные фрагменты',
  unclassified: 'Не классифицировано'
};

function uniq(items) { return [...new Set((items || []).filter(Boolean))]; }
function safeArray(value) { return Array.isArray(value) ? value : []; }
function countWords(value) { return (String(value || '').trim().match(/[\p{L}\p{N}’'-]+/gu) || []).length; }

function walkSteps(steps, visitor) {
  for (const step of steps || []) {
    visitor(step);
    if (step?.type === 'choice') {
      for (const option of step.options || []) walkSteps(option.steps || [], visitor);
    }
  }
}

function parseSet(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^([A-Za-zА-Яа-я_][\wА-Яа-я.]*)\s*(\+=|-=|=|\+|-)\s*(.+)$/u);
  if (!match) return { raw, variable: raw.split(/\s+/)[0] || raw, operator: null, value: null };
  return { raw, variable: match[1], operator: match[2], value: match[3].trim() };
}

function variablesFromCondition(value) {
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value || '');
  const variables = new Set();
  for (const match of raw.matchAll(/\b(?:choice\.)?([A-Za-zА-Яа-я_][\wА-Яа-я.]*)\b/gu)) {
    const token = match[1];
    if (/^(TRUE|FALSE|AND|OR|NOT|IN)$/i.test(token)) continue;
    if (/^\d/.test(token)) continue;
    variables.add(token);
  }
  return [...variables];
}

function conditionDecisionIds(value) {
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value || '');
  return uniq([...raw.matchAll(/(?:choice\.)?\b((?:C\d{2}|FINAL|E\d(?:_[A-Z]+)?))\b/gi)].map(match => match[1].toUpperCase()));
}

function normalizeBranchContext(value) {
  if (!value) return null;
  if (typeof value === 'string') return { label: value, condition: value };
  return { label: value.label || value.id || '', condition: value.condition || value.when || '' };
}

function sceneWordCount(scene) {
  let words = 0;
  walkSteps(scene?.steps || [], step => {
    if (step?.type === 'choice') {
      words += countWords(step.prompt);
      for (const option of step.options || []) words += countWords(option.label);
    } else if (step?.type !== 'tech') words += countWords(step?.text);
  });
  return words;
}

function routeKey(scene, sourceLayoutByScene = new Map()) {
  if (scene?.finalRoute === 'A') return 'oath';
  if (scene?.finalRoute === 'B') return 'network';
  if (scene?.finalRoute === 'C') return 'break';
  const hint = String(scene?.editor?.routeHint || sourceLayoutByScene.get(scene?.id)?.routeHint || '').toLowerCase();
  if (['equal', 'fire', 'mask', 'direct'].includes(hint)) return hint;
  const id = String(scene?.id || '').toUpperCase();
  if (/(?:^|_)EQUAL(?:_|$)/.test(id)) return 'equal';
  if (/(?:^|_)FIRE(?:_|$)/.test(id)) return 'fire';
  if (/(?:^|_)MASK(?:_|$)/.test(id)) return 'mask';
  if (/(?:^|_)DIRECT(?:_|$)/.test(id)) return 'direct';
  return 'common';
}

function sourceGraphFromContent(content) {
  const graph = content?.storyMetadata?.sourceGraph || content?.sourceGraph || null;
  return graph && Array.isArray(graph.edges) ? graph : null;
}

function structuralGroups(content, scenes, sourceGraph) {
  const explicit = safeArray(content?.storyMetadata?.structuralGroups);
  const explicitById = new Map(explicit.map(group => [group.id, group]));
  const layoutByScene = new Map(safeArray(sourceGraph?.layout).map(item => [item.sceneId, item]));
  const groups = [];
  const seen = new Set();
  scenes.forEach(scene => {
    const groupId = scene?.editor?.group || layoutByScene.get(scene.id)?.group || scene.chapterId || scene.chapterTitle || 'OTHER';
    if (seen.has(groupId)) return;
    seen.add(groupId);
    const source = explicitById.get(groupId);
    groups.push({ id: groupId, title: source?.title || scene.chapterTitle || groupId, order: source?.order ?? groups.length });
  });
  return groups.sort((a, b) => a.order - b.order);
}

function sceneEnds(scene) {
  if (scene?.finalRoute) return true;
  let result = false;
  walkSteps(scene?.steps || [], step => {
    if (step?.type === 'tech' && step.command === 'SYSTEM' && /^END(?:\s+ROUTE_|\b)/i.test(String(step.value || ''))) result = true;
  });
  return result;
}

function optionDetails(option) {
  const gotos = [];
  const effects = [];
  const conditions = [];
  if (option?.goto) gotos.push(option.goto);
  if (option?.fallbackGoto) gotos.push(option.fallbackGoto);
  if (option?.condition) conditions.push(option.condition);
  walkSteps(option?.steps || [], step => {
    if (step?.type !== 'tech') return;
    if (step.command === 'GOTO') gotos.push(step.value);
    if (step.command === 'SET') effects.push(parseSet(step.value));
    if (step.command === 'IF') conditions.push(step.value);
  });
  return {
    id: String(option?.id || ''),
    label: option?.label || option?.id || 'Вариант',
    targetBranch: option?.targetBranch || null,
    condition: option?.condition || null,
    gotos: uniq(gotos),
    effects: effects.filter(Boolean),
    conditions,
    variables: uniq([...effects.filter(Boolean).map(effect => effect.variable), ...conditions.flatMap(variablesFromCondition)]),
    raw: option
  };
}

function sceneFragmentIds(scene) {
  const ids = [];
  walkSteps(scene?.steps || [], step => {
    if (step?.fragmentId) ids.push(String(step.fragmentId));
  });
  return uniq(ids);
}

function collectOccurrences(scenes) {
  const occurrences = [];
  const byScene = new Map();
  const bySceneChoice = new Map();
  scenes.forEach((scene, sceneIndex) => {
    const topChoices = safeArray(scene.steps).filter(step => step?.type === 'choice');
    topChoices.forEach((step, index) => {
      const choiceId = String(step.id || `CHOICE_${sceneIndex}_${index}`);
      const occurrenceId = `occurrence:${scene.id}:${choiceId}:${index}`;
      const branchContexts = [];
      walkSteps(scene.steps || [], item => {
        const context = normalizeBranchContext(item?.branchContext);
        if (context) branchContexts.push(context);
      });
      const occurrence = {
        id: occurrenceId,
        occurrenceId,
        kind: 'decisionOccurrence',
        choiceId,
        sceneId: scene.id,
        sceneTitle: scene.title,
        chapterId: scene.chapterId || null,
        chapterTitle: scene.chapterTitle || 'Другие',
        prompt: step.prompt || choiceId,
        fragmentId: step.fragmentId || null,
        fragmentIds: step.fragmentId ? [String(step.fragmentId)] : [],
        order: sceneIndex + .3 + index * .06,
        occurrenceIndex: index,
        options: safeArray(step.options).map(optionDetails),
        branchContexts,
        editorialTrace: step.editorialTrace || '',
        materialTrace: step.materialTrace || '',
        rulesText: step.rulesText || '',
        raw: step
      };
      occurrences.push(occurrence);
      if (!byScene.has(scene.id)) byScene.set(scene.id, []);
      byScene.get(scene.id).push(occurrence);
      bySceneChoice.set(`${scene.id}::${choiceId}`, occurrence);
    });
  });
  return { occurrences, byScene, bySceneChoice };
}

function decisionDependencies(decisions, sceneRecords) {
  const writers = new Map();
  decisions.forEach(decision => {
    decision.occurrences.forEach(occurrence => occurrence.options.forEach(option => option.effects.forEach(effect => {
      if (!effect?.variable) return;
      if (!writers.has(effect.variable)) writers.set(effect.variable, new Set());
      writers.get(effect.variable).add(decision.choiceId);
    })));
  });
  const affectedSceneIds = new Map(decisions.map(decision => [decision.choiceId, new Set()]));
  const affectedDecisionIds = new Map(decisions.map(decision => [decision.choiceId, new Set()]));
  sceneRecords.forEach(scene => {
    scene.dependencies.forEach(choiceId => affectedSceneIds.get(choiceId)?.add(scene.id));
    scene.variableDependencies.forEach(variable => {
      for (const writer of writers.get(variable) || []) affectedSceneIds.get(writer)?.add(scene.id);
    });
    scene.occurrences.forEach(occurrence => {
      const dependentIds = uniq([
        ...occurrence.branchContexts.flatMap(context => conditionDecisionIds(context.condition)),
        ...occurrence.options.flatMap(option => option.conditions.flatMap(conditionDecisionIds))
      ]);
      dependentIds.forEach(choiceId => affectedDecisionIds.get(choiceId)?.add(occurrence.choiceId));
    });
  });
  decisions.forEach(decision => {
    decision.affectedSceneIds = [...(affectedSceneIds.get(decision.choiceId) || [])];
    decision.affectedDecisionIds = [...(affectedDecisionIds.get(decision.choiceId) || [])].filter(id => id !== decision.choiceId);
    decision.influencesEnding = decision.choiceId === 'FINAL' || decision.affectedSceneIds.some(id => /(?:ch1[01]|ep|final)/i.test(id)) || /финал|кульминац/i.test(`${decision.title} ${decision.editorialTrace}`);
  });
}

function logicalDecisions(occurrences, sceneRecords) {
  const sceneById = new Map(sceneRecords.map(scene => [scene.id, scene]));
  const grouped = new Map();
  occurrences.forEach(occurrence => {
    if (!grouped.has(occurrence.choiceId)) grouped.set(occurrence.choiceId, []);
    grouped.get(occurrence.choiceId).push(occurrence);
  });
  const decisions = [...grouped].map(([choiceId, items]) => {
    const optionMap = new Map();
    items.forEach(item => item.options.forEach(option => {
      const key = option.id || option.label;
      if (!optionMap.has(key)) optionMap.set(key, { ...option, occurrences: [] });
      optionMap.get(key).occurrences.push(item.occurrenceId);
    }));
    const text = items.map(item => `${item.prompt} ${item.editorialTrace} ${item.materialTrace}`).join(' ');
    const mainLattice = /^C(?:0[1-9]|1\d|2[0-2])$/i.test(choiceId);
    const effects = [...optionMap.values()].flatMap(option => option.effects);
    const significant = items.some(item => item.options.some(option => option.gotos.length || option.effects.length || option.conditions.length)) || items.length > 1;
    const occurrenceScenes = items.map(item => sceneById.get(item.sceneId)).filter(Boolean);
    const firstScene = occurrenceScenes.slice().sort((a, b) => a.order - b.order)[0] || null;
    const storylineIds = uniq(occurrenceScenes.flatMap(scene => scene.storylineIds || []));
    const structuralGroupIds = uniq(occurrenceScenes.map(scene => scene.structuralGroupId));
    return {
      id: `decision:${choiceId}`,
      kind: 'logicalDecision',
      decisionId: choiceId,
      choiceId,
      title: items[0]?.prompt || choiceId,
      occurrences: items,
      occurrenceCount: items.length,
      repeated: items.length > 1,
      chapterTitles: uniq(items.map(item => item.chapterTitle)),
      chapterId: firstScene?.chapterId || null,
      structuralGroupId: firstScene?.structuralGroupId || structuralGroupIds[0] || null,
      structuralGroupIds,
      storylineIds: storylineIds.length ? storylineIds : ['common'],
      primaryStorylineId: firstScene?.primaryStorylineId || storylineIds[0] || 'common',
      routeKey: firstScene?.routeKey || 'common',
      firstSceneId: firstScene?.id || items[0]?.sceneId || null,
      firstOrder: Math.min(...items.map(item => item.order)),
      lastOrder: Math.max(...items.map(item => item.order)),
      options: [...optionMap.values()],
      optionCount: optionMap.size,
      significant,
      mainLattice,
      editorialTrace: items.map(item => item.editorialTrace).filter(Boolean).join(' '),
      materialTrace: items.map(item => item.materialTrace).filter(Boolean).join(' '),
      variables: uniq(effects.map(effect => effect?.variable)),
      fragmentIds: uniq(items.flatMap(item => item.fragmentIds || [])),
      metrics: { scenes: items.length, frames: 0, words: items.reduce((sum, item) => sum + countWords(item.prompt), 0), reviews: 0, missing: 0 },
      affectedSceneIds: [],
      affectedDecisionIds: [],
      influencesEnding: /final|финал/i.test(`${choiceId} ${text}`)
    };
  }).sort((a, b) => a.firstOrder - b.firstOrder);
  decisionDependencies(decisions, sceneRecords);
  return decisions;
}

function resolveTarget(raw, sceneIds) {
  const value = String(raw || '').trim().replace(/[.;]+$/, '').replace(/^GOTO\s+/i, '').trim();
  if (!value) return [];
  if (sceneIds.has(value)) return [value];
  if (/соответствующая маршрутная сцена/i.test(value)) return ['CH03_SC03_EQUAL', 'CH03_SC03_FIRE', 'CH03_SC03_MASK'].filter(id => sceneIds.has(id));
  if (/согласно\s+ROUTE_ID/i.test(value)) return ['CH06_SC04_DIRECT', 'CH06_SC05_EQUAL', 'CH06_SC05_FIRE', 'CH06_SC05_MASK'].filter(id => sceneIds.has(id));
  return [];
}

function createEndingNodes(content, scenes, sourceSceneEdges, sourceLayoutByScene) {
  const finals = safeArray(content?.storyMetadata?.finals || content?.finals);
  if (finals.length) return finals.map((item, index) => {
    const endingId = String(item?.id || String.fromCharCode(65 + index)).toUpperCase();
    return {
      id: `ending:${endingId}`, kind: 'ending', endingId,
      title: item?.title || item?.name || `Финал ${endingId}`,
      routeKey: endingId === 'A' ? 'oath' : endingId === 'B' ? 'network' : endingId === 'C' ? 'break' : 'common',
      laneId: endingId === 'A' ? 'oath' : endingId === 'B' ? 'network' : endingId === 'C' ? 'break' : 'common',
      storylineIds: [endingId === 'A' ? 'oath' : endingId === 'B' ? 'network' : endingId === 'C' ? 'break' : 'common'],
      structuralGroupId: scenes.at(-1)?.structuralGroupId || null,
      order: scenes.length + index,
      chapterTitle: scenes.at(-1)?.chapterTitle || 'Финалы',
      metrics: { scenes: 0, frames: 0, words: 0, reviews: 0, missing: 0 },
      sourceSceneIds: []
    };
  });

  const out = new Map(scenes.map(scene => [scene.id, 0]));
  sourceSceneEdges.forEach(edge => out.set(edge.from, (out.get(edge.from) || 0) + 1));
  const terminals = scenes.filter(scene => !out.get(scene.id));
  const groups = new Map();
  terminals.forEach(scene => {
    const key = routeKey(scene, sourceLayoutByScene);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(scene);
  });
  return [...groups].map(([key, items], index) => ({
    id: `ending:${key}:${index}`, kind: 'ending', endingId: key.toUpperCase(),
    title: key === 'common' ? items[0]?.title || 'Финал' : ROUTE_LABELS[key] || items[0]?.title || 'Финал',
    routeKey: key, laneId: key, storylineIds: [key], structuralGroupId: items.at(-1)?.structuralGroupId || items[0]?.structuralGroupId || null,
    order: scenes.length + index, chapterTitle: items[0]?.chapterTitle || 'Финалы',
    sourceSceneIds: items.map(scene => scene.id),
    metrics: { scenes: items.length, frames: 0, words: 0, reviews: 0, missing: 0 }
  }));
}

function sourceEdges(sourceGraph, occurrenceBySceneChoice) {
  const result = [];
  const entered = new Set();
  safeArray(sourceGraph?.edges).forEach(edge => {
    if (edge.choiceId) {
      const occurrence = occurrenceBySceneChoice.get(`${edge.from}::${edge.choiceId}`);
      if (occurrence) {
        const enterKey = `${edge.from}::${occurrence.id}`;
        if (!entered.has(enterKey)) {
          entered.add(enterKey);
          result.push({ from: `scene:${edge.from}`, to: occurrence.id, kind: 'choice-enter', source: 'sourceGraph' });
        }
        const option = occurrence.options.find(item => item.id === edge.optionId);
        result.push({ from: occurrence.id, to: `scene:${edge.to}`, kind: 'option', label: option?.label || edge.optionId || 'Вариант', optionId: edge.optionId || null, source: 'sourceGraph' });
        return;
      }
    }
    result.push({ from: `scene:${edge.from}`, to: `scene:${edge.to}`, kind: edge.kind || 'goto', source: 'sourceGraph' });
  });
  return result;
}

function inferredEdges(content, scenes, occurrencesByScene, endings) {
  const ids = new Set(scenes.map(scene => scene.id));
  const endingById = new Map(endings.map(ending => [ending.endingId, ending]));
  const result = [];
  scenes.forEach((scene, index) => {
    const occurrences = occurrencesByScene.get(scene.id) || [];
    const nextScene = scenes[index + 1] || null;
    const sceneId = `scene:${scene.id}`;
    if (occurrences.length) {
      result.push({ from: sceneId, to: occurrences[0].id, kind: 'choice-enter', source: 'inferred' });
      occurrences.forEach((occurrence, occurrenceIndex) => {
        const nextOccurrence = occurrences[occurrenceIndex + 1] || null;
        occurrence.options.forEach(option => {
          const targets = uniq(option.gotos.flatMap(raw => resolveTarget(raw, ids)));
          if (targets.length) {
            targets.forEach(target => result.push({ from: occurrence.id, to: `scene:${target}`, kind: 'option', label: option.label, optionId: option.id, source: 'inferred' }));
            return;
          }
          const optionKey = String(option.id || '').toUpperCase();
          const finalChoice = String(occurrence.choiceId).toUpperCase() === 'FINAL';
          if (finalChoice && nextScene && !sceneEnds(scene)) {
            result.push({ from: occurrence.id, to: `scene:${nextScene.id}`, kind: 'option', label: option.label, optionId: option.id, finalRoute: optionKey, reconverges: true, source: 'inferred' });
          } else if (finalChoice && endingById.has(optionKey)) {
            result.push({ from: occurrence.id, to: endingById.get(optionKey).id, kind: 'option', label: option.label, optionId: option.id, finalRoute: optionKey, source: 'inferred' });
          } else if (nextOccurrence) {
            result.push({ from: occurrence.id, to: nextOccurrence.id, kind: 'option', label: option.label, optionId: option.id, reconverges: true, source: 'inferred' });
          } else if (nextScene && !sceneEnds(scene)) {
            result.push({ from: occurrence.id, to: `scene:${nextScene.id}`, kind: 'option', label: option.label, optionId: option.id, reconverges: true, source: 'inferred' });
          }
        });
      });
      return;
    }
    const gotos = [];
    safeArray(scene.steps).forEach(step => { if (step?.type === 'tech' && step.command === 'GOTO') gotos.push(...resolveTarget(step.value, ids)); });
    if (gotos.length) uniq(gotos).forEach(target => result.push({ from: sceneId, to: `scene:${target}`, kind: 'goto', source: 'inferred' }));
    else if (nextScene && !sceneEnds(scene)) result.push({ from: sceneId, to: `scene:${nextScene.id}`, kind: 'sequence', source: 'inferred' });
  });
  return result;
}

function attachEndings(edges, endings, scenes, sourceLayoutByScene) {
  const result = [...edges];
  const out = new Map(scenes.map(scene => [`scene:${scene.id}`, 0]));
  result.forEach(edge => out.set(edge.from, (out.get(edge.from) || 0) + 1));
  endings.forEach(ending => {
    if (ending.sourceSceneIds?.length) {
      ending.sourceSceneIds.forEach(sceneId => { if (!result.some(edge => edge.from === `scene:${sceneId}` && edge.to === ending.id)) result.push({ from: `scene:${sceneId}`, to: ending.id, kind: 'ending', source: 'virtual' }); });
      return;
    }
    const candidates = scenes.filter(scene => String(scene.finalRoute || '').toUpperCase() === ending.endingId);
    if (candidates.length) {
      const last = candidates.at(-1);
      if (!result.some(edge => edge.from === `scene:${last.id}` && edge.to === ending.id)) result.push({ from: `scene:${last.id}`, to: ending.id, kind: 'ending', source: 'virtual' });
      return;
    }
    const terminal = scenes.filter(scene => !out.get(`scene:${scene.id}`));
    const matched = terminal.filter(scene => routeKey(scene, sourceLayoutByScene) === ending.routeKey);
    (matched.length ? matched : terminal).forEach(scene => {
      if (!result.some(edge => edge.from === `scene:${scene.id}` && edge.to === ending.id)) result.push({ from: `scene:${scene.id}`, to: ending.id, kind: 'ending', source: 'virtual' });
    });
  });
  return result;
}

function sourceDrivenStoryline(scene, sourceLayoutByScene, overrides = {}) {
  const manual = overrides?.sceneStorylines?.[scene.id];
  if (Array.isArray(manual) && manual.length) return { ids: manual, source: 'manual', confidence: 1 };
  const route = routeKey(scene, sourceLayoutByScene);
  if (route !== 'common') return { ids: [route], source: 'routeHint', confidence: 1 };
  let conditional = false;
  walkSteps(scene.steps || [], step => { if (step?.branchContext) conditional = true; });
  if (conditional) return { ids: ['conditional'], source: 'branchContext', confidence: .9 };
  return { ids: ['common'], source: 'common', confidence: 1 };
}

function storylineCatalog(sceneRecords) {
  const ids = uniq(sceneRecords.flatMap(scene => scene.storylineIds));
  const order = ['common', 'equal', 'fire', 'mask', 'direct', 'conditional', 'oath', 'network', 'break', 'unclassified'];
  return ids.map(id => ({ id, title: ROUTE_LABELS[id] || id, order: order.indexOf(id) >= 0 ? order.indexOf(id) : 99 })).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));
}

function graphIndex(nodes, edges) {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const incoming = new Map(nodes.map(node => [node.id, []]));
  const outgoing = new Map(nodes.map(node => [node.id, []]));
  edges.forEach(edge => {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) return;
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  });
  return { nodeById, incoming, outgoing };
}

export function validateStoryGraph(model) {
  const errors = [];
  const warnings = [];
  const ids = new Set(model.nodes.map(node => node.id));
  const duplicates = model.nodes.map(node => node.id).filter((id, index, all) => all.indexOf(id) !== index);
  duplicates.forEach(id => errors.push({ code: 'DUPLICATE_NODE', nodeId: id, message: `Повторяющийся идентификатор ${id}` }));
  model.edges.forEach(edge => {
    if (!ids.has(edge.from)) errors.push({ code: 'MISSING_FROM', edge, message: `Отсутствует источник ${edge.from}` });
    if (!ids.has(edge.to)) errors.push({ code: 'MISSING_TO', edge, message: `Отсутствует цель ${edge.to}` });
  });
  const start = model.sceneNodes.find(node => node.start);
  if (!start) errors.push({ code: 'NO_START', message: 'Не найдена стартовая сцена' });
  if (!model.endings.length) warnings.push({ code: 'NO_ENDINGS', message: 'Финалы не определены' });

  if (start) {
    const { outgoing } = graphIndex(model.nodes, model.edges);
    const visited = new Set([start.id]);
    const stack = [start.id];
    while (stack.length) {
      const id = stack.pop();
      for (const edge of outgoing.get(id) || []) if (!visited.has(edge.to)) { visited.add(edge.to); stack.push(edge.to); }
    }
    model.sceneNodes.filter(node => !visited.has(node.id)).forEach(node => warnings.push({ code: 'UNREACHABLE_SCENE', nodeId: node.id, message: `Сцена ${node.sceneId} недостижима от старта` }));
    model.endings.filter(node => !visited.has(node.id)).forEach(node => warnings.push({ code: 'UNREACHABLE_ENDING', nodeId: node.id, message: `Финал ${node.title} недостижим` }));
  }
  return { valid: !errors.length, errors, warnings };
}

function fixtureSummary(model) {
  const sceneEdges = model.sourceGraph?.edges || [];
  const inDegree = new Map();
  const outDegree = new Map();
  sceneEdges.forEach(edge => { inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1); outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1); });
  const fixture = model.content?.storyMetadata?.graphFixture || {};
  const summary = {
    chapters: model.chapterOrder.length,
    scenes: model.sceneRecords.length,
    blocks: fixture.blocks ?? null,
    choiceOccurrences: model.decisionOccurrences.length,
    uniqueChoiceIds: model.decisions.length,
    choiceOptions: model.decisionOccurrences.reduce((sum, occurrence) => sum + occurrence.options.length, 0),
    explicitEdges: sceneEdges.length || null,
    branchPoints: sceneEdges.length ? [...outDegree.values()].filter(value => value > 1).length : model.decisionOccurrences.length,
    mergePoints: sceneEdges.length ? [...inDegree.values()].filter(value => value > 1).length : model.mergeSceneIds.length,
    maxFanIn: sceneEdges.length ? Math.max(0, ...inDegree.values()) : model.maxFanIn,
    maxFanOut: sceneEdges.length ? Math.max(0, ...outDegree.values()) : model.maxFanOut,
    mainDecisionIds: model.decisions.filter(decision => decision.mainLattice).length,
    c15Occurrences: model.decisions.find(decision => decision.choiceId === 'C15')?.occurrenceCount || 0,
    c18Occurrences: model.decisions.find(decision => decision.choiceId === 'C18')?.occurrenceCount || 0,
    branchMarkers: fixture.branchMarkers ?? model.sceneRecords.reduce((sum, scene) => sum + scene.branchMarkers, 0),
    variables: fixture.variables ?? model.variables.length,
    reviewRoutes: model.reviewRoutes.length,
    endings: model.endings.length
  };
  const diff = {};
  Object.entries(fixture).forEach(([key, expected]) => {
    if (summary[key] !== undefined && expected !== null && summary[key] !== expected) diff[key] = { expected, actual: summary[key] };
  });
  return { summary, expected: fixture, diff, ok: !Object.keys(diff).length };
}

export function buildStoryGraphModel(content, assignments = [], reviews = [], { graphOverrides = null } = {}) {
  const scenes = safeArray(content?.scenes);
  const sourceGraph = sourceGraphFromContent(content);
  const sourceLayoutByScene = new Map(safeArray(sourceGraph?.layout).map(item => [item.sceneId, item]));
  const groups = structuralGroups(content, scenes, sourceGraph);
  const groupById = new Map(groups.map(group => [group.id, group]));
  const { occurrences, byScene, bySceneChoice } = collectOccurrences(scenes);
  const sceneRecords = scenes.map((scene, order) => {
    const contexts = [];
    const dependencies = new Set();
    const variableDependencies = new Set();
    let branchMarkers = 0;
    walkSteps(scene.steps || [], step => {
      const context = normalizeBranchContext(step?.branchContext);
      if (context) { contexts.push(context); branchMarkers++; conditionDecisionIds(context.condition).forEach(id => dependencies.add(id)); variablesFromCondition(context.condition).forEach(variable => variableDependencies.add(variable)); }
      if (step?.type === 'tech' && step.command === 'IF') { conditionDecisionIds(step.value).forEach(id => dependencies.add(id)); variablesFromCondition(step.value).forEach(variable => variableDependencies.add(variable)); }
      if (step?.condition) { conditionDecisionIds(step.condition).forEach(id => dependencies.add(id)); variablesFromCondition(step.condition).forEach(variable => variableDependencies.add(variable)); }
    });
    const groupId = scene?.editor?.group || sourceLayoutByScene.get(scene.id)?.group || scene.chapterId || scene.chapterTitle || 'OTHER';
    const classification = sourceDrivenStoryline(scene, sourceLayoutByScene, graphOverrides || content?.storyMetadata?.graphOverrides || {});
    return {
      ...scene,
      order,
      code: scene.code || null,
      chapterTitle: scene.chapterTitle || groupById.get(groupId)?.title || 'Другие',
      structuralGroupId: groupId,
      routeKey: routeKey(scene, sourceLayoutByScene),
      storylineIds: classification.ids,
      primaryStorylineId: classification.ids[0] || 'common',
      storylineSource: classification.source,
      storylineConfidence: classification.confidence,
      words: sceneWordCount(scene),
      fragmentIds: sceneFragmentIds(scene),
      metrics: { ...sceneFrameMetrics(content, scene.id, assignments, reviews) },
      occurrences: byScene.get(scene.id) || [],
      dependencies: [...dependencies],
      variableDependencies: [...variableDependencies],
      branchContexts: contexts,
      branchMarkers
    };
  });
  const sceneById = new Map(sceneRecords.map(scene => [scene.id, scene]));
  const decisions = logicalDecisions(occurrences, sceneRecords);
  const sceneNodes = sceneRecords.map(scene => ({
    id: `scene:${scene.id}`, kind: 'scene', sceneId: scene.id, title: scene.title,
    code: scene.code, chapterId: scene.chapterId || null, chapterTitle: scene.chapterTitle,
    structuralGroupId: scene.structuralGroupId, order: scene.order, start: scene.id === content.startScene,
    end: sceneEnds(scene), routeKey: scene.routeKey, storylineIds: scene.storylineIds,
    primaryStorylineId: scene.primaryStorylineId, fragmentIds: scene.fragmentIds,
    metrics: { ...scene.metrics, words: scene.words }, raw: scene
  }));
  const occurrenceNodes = occurrences.map(occurrence => ({ ...occurrence, id: occurrence.occurrenceId, title: occurrence.prompt, optionCount: occurrence.options.length, metrics: { scenes: 0, frames: 0, words: countWords(occurrence.prompt), reviews: 0, missing: 0 } }));

  const provisionalSceneEdges = sourceGraph?.edges || scenes.slice(0, -1).map((scene, index) => ({ from: scene.id, to: scenes[index + 1].id }));
  const endings = createEndingNodes(content, sceneRecords, provisionalSceneEdges, sourceLayoutByScene);
  let edges = sourceGraph ? sourceEdges(sourceGraph, bySceneChoice) : inferredEdges(content, sceneRecords, byScene, endings);
  edges = attachEndings(edges, endings, sceneRecords, sourceLayoutByScene);

  const baseNodes = [...sceneNodes, ...occurrenceNodes, ...endings];
  const index = graphIndex(baseNodes, edges);
  const mergeSceneIds = sceneNodes.filter(node => (index.incoming.get(node.id)?.length || 0) > 1).map(node => node.sceneId);
  const maxFanIn = Math.max(0, ...sceneNodes.map(node => index.incoming.get(node.id)?.length || 0));
  const maxFanOut = Math.max(0, ...baseNodes.map(node => index.outgoing.get(node.id)?.length || 0));
  const variables = uniq([
    ...Object.keys(content?.initialVars || {}),
    ...decisions.flatMap(decision => decision.variables),
    ...sceneRecords.flatMap(scene => scene.variableDependencies)
  ]);
  const model = {
    schema: 'heartline-story-graph-model-v2.1',
    projectId: content?.id || 'project',
    contentVersion: content?.contentVersion || 'unknown',
    content,
    sourceGraph,
    sourceLayoutByScene,
    sceneRecords,
    sceneById,
    sceneNodes,
    decisionOccurrences: occurrences,
    decisions,
    endings,
    nodes: baseNodes,
    edges,
    chapterOrder: uniq(sceneRecords.map(scene => scene.chapterTitle)),
    structuralGroups: groups,
    storylines: storylineCatalog(sceneRecords),
    routeFamilies: [],
    reviewRoutes: safeArray(content?.storyMetadata?.reviewRoutes || content?.reviewRoutes),
    variables,
    mergeSceneIds,
    maxFanIn,
    maxFanOut,
    graphOverrides: graphOverrides || content?.storyMetadata?.graphOverrides || {},
    metrics: content?.storyMetadata?.metrics || {}
  };
  model.integrity = validateStoryGraph(model);
  model.fixture = fixtureSummary(model);
  return model;
}

export { ROUTE_LABELS, fixtureSummary as graphFixtureSummary, graphIndex as indexStoryGraph };
