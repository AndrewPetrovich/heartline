import { indexStoryGraph, ROUTE_LABELS } from './heartline-graph-model.js';

function uniq(items) { return [...new Set((items || []).filter(Boolean))]; }
function sum(items, selector) { return (items || []).reduce((total, item) => total + Number(selector(item) || 0), 0); }
function sceneNodeId(sceneId) { return `scene:${sceneId}`; }

function aggregateMetrics(items) {
  return {
    scenes: sum(items, item => item.metrics?.scenes ?? (item.kind === 'scene' || item.id ? 1 : 0)),
    frames: sum(items, item => item.metrics?.frames),
    words: sum(items, item => item.metrics?.words ?? item.words),
    reviews: sum(items, item => item.metrics?.reviews),
    missing: sum(items, item => item.metrics?.missing),
    choices: sum(items, item => item.metrics?.choices),
    branches: sum(items, item => item.metrics?.branches)
  };
}

function selectDistributed(items, limit, groupKey, score) {
  if (items.length <= limit) return [...items];
  const groups = new Map();
  items.forEach(item => {
    const key = groupKey(item) || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const selected = [];
  for (const values of groups.values()) {
    values.sort((a, b) => score(b) - score(a) || (a.order ?? a.firstOrder ?? 0) - (b.order ?? b.firstOrder ?? 0));
    if (values[0]) selected.push(values[0]);
  }
  const rest = items.filter(item => !selected.includes(item)).sort((a, b) => score(b) - score(a) || (a.order ?? a.firstOrder ?? 0) - (b.order ?? b.firstOrder ?? 0));
  selected.push(...rest.slice(0, Math.max(0, limit - selected.length)));
  return selected.slice(0, limit);
}

export function stronglyConnectedComponents(nodes, edges) {
  const ids = nodes.map(node => node.id);
  const outgoing = new Map(ids.map(id => [id, []]));
  edges.forEach(edge => { if (outgoing.has(edge.from) && outgoing.has(edge.to)) outgoing.get(edge.from).push(edge.to); });
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const low = new Map();
  const components = [];
  function visit(id) {
    indices.set(id, index); low.set(id, index); index++; stack.push(id); onStack.add(id);
    for (const next of outgoing.get(id) || []) {
      if (!indices.has(next)) { visit(next); low.set(id, Math.min(low.get(id), low.get(next))); }
      else if (onStack.has(next)) low.set(id, Math.min(low.get(id), indices.get(next)));
    }
    if (low.get(id) === indices.get(id)) {
      const component = [];
      while (stack.length) {
        const current = stack.pop(); onStack.delete(current); component.push(current);
        if (current === id) break;
      }
      components.push(component);
    }
  }
  ids.forEach(id => { if (!indices.has(id)) visit(id); });
  return components;
}

export function collapseScc(nodes, edges) {
  const components = stronglyConnectedComponents(nodes, edges);
  const nodeToComponent = new Map();
  components.forEach((component, index) => component.forEach(id => nodeToComponent.set(id, `scc:${index}`)));
  const componentNodes = components.map((component, index) => ({ id: `scc:${index}`, sourceNodeIds: component, cyclic: component.length > 1 }));
  const seen = new Set();
  const componentEdges = [];
  edges.forEach(edge => {
    const from = nodeToComponent.get(edge.from); const to = nodeToComponent.get(edge.to);
    if (!from || !to || from === to) return;
    const key = `${from}|${to}`;
    if (seen.has(key)) return;
    seen.add(key); componentEdges.push({ from, to });
  });
  return { components: componentNodes, edges: componentEdges, nodeToComponent };
}

function decisionNode(decision) {
  return {
    id: decision.id,
    kind: 'logicalDecision',
    decisionId: decision.choiceId,
    choiceId: decision.choiceId,
    title: decision.title,
    chapterTitle: decision.chapterTitles[0] || 'Другие',
    chapterTitles: decision.chapterTitles,
    order: decision.firstOrder,
    optionCount: decision.optionCount,
    occurrenceCount: decision.occurrenceCount,
    occurrences: decision.occurrences,
    options: decision.options,
    significant: decision.significant,
    repeated: decision.repeated,
    mainLattice: decision.mainLattice,
    influencesEnding: decision.influencesEnding,
    affectedSceneIds: decision.affectedSceneIds,
    affectedDecisionIds: decision.affectedDecisionIds,
    variables: decision.variables,
    metrics: decision.metrics,
    fragmentIds: decision.fragmentIds || [],
    structuralGroupId: decision.structuralGroupId || null,
    structuralGroupIds: decision.structuralGroupIds || [],
    laneId: decision.primaryStorylineId || decision.storylineIds?.[0] || 'common',
    storylineIds: decision.storylineIds || [decision.primaryStorylineId || 'common'],
    routeKey: decision.routeKey || 'common',
    firstSceneId: decision.firstSceneId || decision.occurrences?.[0]?.sceneId || null
  };
}

function endingNode(ending) { return { ...ending, kind: 'ending', end: true, laneId: ending.laneId || ending.routeKey || 'common', storylineIds: ending.storylineIds || [ending.routeKey || 'common'] }; }

function presentationEdgeKey(edge) {
  return `${edge.from}|${edge.to}|${edge.kind || ''}|${edge.label || ''}|${edge.optionId || ''}`;
}

function aggregatePresentationEdges(edges) {
  const map = new Map();
  edges.forEach(edge => {
    if (!edge.from || !edge.to || edge.from === edge.to) return;
    const key = presentationEdgeKey(edge);
    if (!map.has(key)) map.set(key, { ...edge, count: 0, hiddenSceneIds: [], hiddenScenes: 0, hiddenFrames: 0, hiddenWords: 0, sourceEdges: [], routeIds: [] });
    const target = map.get(key);
    target.count += edge.count || 1;
    target.hiddenSceneIds.push(...(edge.hiddenSceneIds || []));
    target.hiddenScenes += edge.hiddenScenes || 0;
    target.hiddenFrames += edge.hiddenFrames || 0;
    target.hiddenWords += edge.hiddenWords || 0;
    target.sourceEdges.push(...(edge.sourceEdges || []), ...(edge.sourceEdge ? [edge.sourceEdge] : []));
    target.routeIds.push(...(edge.routeIds || []));
  });
  return [...map.values()].map(edge => ({ ...edge, hiddenSceneIds: uniq(edge.hiddenSceneIds), routeIds: uniq(edge.routeIds) }));
}

function collapseParallelOptionEdges(edges, { metricMode = 'max' } = {}) {
  const groups = new Map();
  edges.forEach(edge => {
    const optionLike = edge.kind === 'option' || edge.kind === 'flow' || edge.kind === 'route' || edge.optionId || edge.label;
    const family = optionLike ? 'option' : edge.kind || 'sequence';
    const key = `${edge.from}|${edge.to}|${family}`;
    if (!groups.has(key)) groups.set(key, { ...edge, count: 0, labels: [], optionIds: [], hiddenSceneIds: [], hiddenScenes: 0, hiddenFrames: 0, hiddenWords: 0, sourceEdges: [], routeIds: [] });
    const target = groups.get(key);
    target.count += edge.count || 1;
    if (edge.label) target.labels.push(edge.label);
    if (edge.optionId) target.optionIds.push(edge.optionId);
    target.hiddenSceneIds.push(...(edge.hiddenSceneIds || []));
    if (metricMode === 'sum') {
      target.hiddenScenes += edge.hiddenScenes || 0; target.hiddenFrames += edge.hiddenFrames || 0; target.hiddenWords += edge.hiddenWords || 0;
    } else {
      target.hiddenScenes = Math.max(target.hiddenScenes, edge.hiddenScenes || 0);
      target.hiddenFrames = Math.max(target.hiddenFrames, edge.hiddenFrames || 0);
      target.hiddenWords = Math.max(target.hiddenWords, edge.hiddenWords || 0);
    }
    target.sourceEdges.push(...(edge.sourceEdges || []), ...(edge.sourceEdge ? [edge.sourceEdge] : []));
    target.routeIds.push(...(edge.routeIds || []));
  });
  return [...groups.values()].map(edge => {
    const labels = uniq(edge.labels); const optionIds = uniq(edge.optionIds);
    const parallelCount = Math.max(labels.length, optionIds.length, edge.count || 1);
    return {
      ...edge, labels, optionIds, routeIds: uniq(edge.routeIds), hiddenSceneIds: uniq(edge.hiddenSceneIds),
      label: labels.length === 1 ? labels[0] : labels.length > 1 ? `${labels.length} варианта` : '',
      parallelCount, collapsedParallel: parallelCount > 1
    };
  });
}

function mapPhysicalEdgesToPresentation(model, nodeMap) {
  const result = [];
  for (const edge of model.edges) {
    const from = nodeMap.get(edge.from); const to = nodeMap.get(edge.to);
    if (!from || !to || from === to) continue;
    const target = model.nodes.find(node => node.id === edge.to);
    result.push({
      from, to, kind: edge.kind, label: edge.label || '', optionId: edge.optionId || null,
      hiddenSceneIds: target?.kind === 'scene' && nodeMap.get(edge.to) !== edge.to ? [target.sceneId] : [],
      hiddenScenes: 0, hiddenFrames: 0, hiddenWords: 0, sourceEdge: edge
    });
  }
  return collapseParallelOptionEdges(aggregatePresentationEdges(result));
}

function beatTitle(scenes) {
  if (!scenes.length) return 'Сюжетный блок';
  if (scenes.length === 1) return scenes[0].title;
  const first = scenes[0].title; const last = scenes.at(-1).title;
  return first === last ? first : `${first} → ${last}`;
}

function storyBeatCandidates(model, maxPerBeat = 5) {
  const grouped = new Map();
  model.sceneRecords.forEach(scene => {
    const lane = scene.primaryStorylineId || 'common';
    const key = `${scene.structuralGroupId}|${lane}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(scene);
  });
  const beats = [];
  for (const [key, values] of grouped) {
    const scenes = values.sort((a, b) => a.order - b.order);
    for (let index = 0; index < scenes.length; index += maxPerBeat) {
      const chunk = scenes.slice(index, index + maxPerBeat);
      const [groupId, laneId] = key.split('|');
      const storylineIds = uniq(chunk.flatMap(scene => scene.storylineIds));
      beats.push({
        id: `beat:${groupId}:${laneId}:${Math.floor(index / maxPerBeat)}`, kind: 'storyBeat',
        title: beatTitle(chunk), structuralGroupId: groupId, chapterTitle: chunk[0]?.chapterTitle || groupId,
        laneId, storylineIds, intersection: storylineIds.length > 1, order: Math.min(...chunk.map(scene => scene.order)),
        storylineSources: uniq(chunk.map(scene => scene.storylineSource)),
        storylineConfidence: Math.min(...chunk.map(scene => Number(scene.storylineConfidence ?? 1))),
        sourceSceneIds: chunk.map(scene => scene.id), firstSceneId: chunk[0]?.id, lastSceneId: chunk.at(-1)?.id,
        fragmentIds: uniq(chunk.flatMap(scene => scene.fragmentIds || [])),
        metrics: { ...aggregateMetrics(chunk), scenes: chunk.length }, routeKey: chunk[0]?.routeKey || 'common'
      });
    }
  }
  return beats.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function chooseMajorDecisions(model, limit = 9) {
  const source = model.decisions.filter(decision => decision.significant || decision.mainLattice || decision.influencesEnding);
  return selectDistributed(source, limit, decision => decision.chapterTitles[0] || 'Другие', decision => (decision.influencesEnding ? 40 : 0) + (decision.repeated ? 15 : 0) + decision.optionCount * 3 + decision.affectedSceneIds.length).sort((a, b) => a.firstOrder - b.firstOrder);
}

function majorMerges(model, limit = 4) {
  const { incoming } = indexStoryGraph(model.nodes, model.edges);
  return model.sceneRecords
    .map(scene => ({ scene, fanIn: incoming.get(sceneNodeId(scene.id))?.length || 0 }))
    .filter(item => item.fanIn > 1)
    .sort((a, b) => b.fanIn - a.fanIn || a.scene.order - b.scene.order)
    .slice(0, limit);
}

export function createStorylinePresentation(model, options = {}) {
  const allBeats = storyBeatCandidates(model, 5);
  const search = String(options.search || '').trim().toLowerCase();
  const majorDecisionRecords = chooseMajorDecisions(model, 9);
  const searchedDecisionRecords = search ? model.decisions.filter(decision => `${decision.choiceId} ${decision.title} ${decision.fragmentIds?.join(' ') || ''} ${decision.occurrences.map(item => item.sceneId).join(' ')}`.toLowerCase().includes(search)) : [];
  const decisions = [...new Map([...majorDecisionRecords, ...searchedDecisionRecords].map(decision => [decision.id, decision])).values()].map(decisionNode);
  const merges = majorMerges(model, 4).map(({ scene, fanIn }, index) => ({
    id: `merge:${scene.id}`, kind: 'merge', title: `Слияние ${index + 1}`, sceneId: scene.id,
    chapterTitle: scene.chapterTitle, structuralGroupId: scene.structuralGroupId, order: scene.order - .04,
    laneId: scene.primaryStorylineId || 'common', fanIn, metrics: { scenes: 1, frames: scene.metrics.frames || 0, words: scene.words || 0, reviews: scene.metrics.reviews || 0, missing: scene.metrics.missing || 0 }, routeKey: scene.routeKey
  }));
  const maxNodes = Number(options.maxNodes || 30);
  const reserved = decisions.length + merges.length + model.endings.length;
  const baseBeats = selectDistributed(allBeats, Math.max(8, maxNodes - reserved), beat => beat.structuralGroupId, beat => beat.metrics.scenes * 5 + beat.metrics.words / 180 + (beat.intersection ? 20 : 0));
  const searchedBeats = search ? allBeats.filter(beat => `${beat.id} ${beat.title} ${beat.chapterTitle} ${beat.sourceSceneIds.join(' ')} ${beat.fragmentIds?.join(' ') || ''}`.toLowerCase().includes(search)) : [];
  const beats = [...new Map([...baseBeats, ...searchedBeats].map(beat => [beat.id, beat])).values()].sort((a, b) => a.order - b.order);
  const nodes = [...beats, ...decisions, ...merges, ...model.endings.map(endingNode)].sort((a, b) => (a.order || 0) - (b.order || 0));
  const nodeMap = new Map();
  beats.forEach(beat => beat.sourceSceneIds.forEach(sceneId => nodeMap.set(sceneNodeId(sceneId), beat.id)));
  decisions.forEach(node => model.decisions.find(item => item.choiceId === node.choiceId)?.occurrences.forEach(occurrence => nodeMap.set(occurrence.id, node.id)));
  merges.forEach(merge => nodeMap.set(sceneNodeId(merge.sceneId), merge.id));
  model.endings.forEach(ending => nodeMap.set(ending.id, ending.id));
  model.sceneRecords.forEach(scene => {
    const id = sceneNodeId(scene.id); if (nodeMap.has(id)) return;
    const candidates = beats.filter(beat => beat.structuralGroupId === scene.structuralGroupId && beat.laneId === scene.primaryStorylineId);
    const fallback = candidates.length ? candidates : beats.filter(beat => beat.structuralGroupId === scene.structuralGroupId);
    const closest = fallback.sort((a, b) => Math.abs(a.order - scene.order) - Math.abs(b.order - scene.order))[0];
    if (closest) nodeMap.set(id, closest.id);
  });
  model.decisionOccurrences.forEach(occurrence => { if (!nodeMap.has(occurrence.id)) { const sceneTarget = nodeMap.get(sceneNodeId(occurrence.sceneId)); if (sceneTarget) nodeMap.set(occurrence.id, sceneTarget); } });
  let edges = mapPhysicalEdgesToPresentation(model, nodeMap);
  merges.forEach(merge => { const beat = beats.find(item => item.sourceSceneIds.includes(merge.sceneId)); if (beat && beat.id !== merge.id) edges.push({ from: merge.id, to: beat.id, kind: 'rejoin', count: 1, hiddenScenes: 0, hiddenFrames: 0, hiddenWords: 0, hiddenSceneIds: [] }); });
  edges = collapseParallelOptionEdges(aggregatePresentationEdges(edges));
  const usedLanes = new Set(nodes.map(node => node.laneId || 'common'));
  const lanes = model.storylines.filter(line => usedLanes.has(line.id));
  // Ending routes may exist only in storyMetadata.finals and therefore are not
  // present in the scene-driven storyline catalogue. Add every used lane so
  // endings never collapse onto the same coordinates and trigger Safe Layout.
  for (const laneId of usedLanes) {
    if (!lanes.some(line => line.id === laneId)) {
      lanes.push({ id: laneId, title: ROUTE_LABELS[laneId] || laneId, order: 20 + lanes.length });
    }
  }
  lanes.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.title).localeCompare(String(b.title), 'ru'));
  if (!lanes.some(line => line.id === 'common')) lanes.unshift({ id: 'common', title: 'Общая линия', order: 0 });
  return { viewType: 'story', title: 'Карта сюжета', nodes, edges, lanes, groups: model.structuralGroups, metadata: { allBeatCount: allBeats.length, shownBeatCount: beats.length, decisionCount: decisions.length, mergeCount: merges.length, aggregated: allBeats.length > beats.length } };
}

function decisionScopeFilter(model, scope) {
  if (scope === 'main') { const main = model.decisions.filter(decision => decision.mainLattice); if (main.length) return main; }
  if (scope === 'ending') return model.decisions.filter(decision => decision.influencesEnding || decision.choiceId === 'FINAL');
  if (scope === 'repeated') return model.decisions.filter(decision => decision.repeated);
  if (scope === 'local') return model.decisions.filter(decision => !decision.significant);
  return model.decisions;
}

function traverseToVisible(model, startId, occurrenceToLogical, visiblePhysical, maxSteps = 800) {
  const { nodeById, outgoing } = indexStoryGraph(model.nodes, model.edges);
  const results = [];
  const queue = [{ id: startId, scenes: [], frames: 0, words: 0, label: '', optionId: null }];
  const visited = new Set();
  let steps = 0;
  while (queue.length && steps++ < maxSteps) {
    const current = queue.shift();
    const stateKey = `${current.id}|${current.label}|${current.optionId || ''}`;
    if (visited.has(stateKey)) continue; visited.add(stateKey);
    for (const edge of outgoing.get(current.id) || []) {
      const carriedLabel = current.label || (edge.kind === 'option' ? edge.label || '' : '');
      const carriedOptionId = current.optionId || (edge.kind === 'option' ? edge.optionId || null : null);
      const target = occurrenceToLogical.get(edge.to) || (visiblePhysical.has(edge.to) ? edge.to : null);
      if (target && target !== startId) {
        results.push({ to: target, label: carriedLabel, optionId: carriedOptionId, hiddenSceneIds: current.scenes, hiddenScenes: current.scenes.length, hiddenFrames: current.frames, hiddenWords: current.words, sourceEdge: edge });
        continue;
      }
      const node = nodeById.get(edge.to); const isScene = node?.kind === 'scene';
      queue.push({ id: edge.to, scenes: isScene ? [...current.scenes, node.sceneId] : current.scenes, frames: current.frames + (isScene ? node.metrics?.frames || 0 : 0), words: current.words + (isScene ? node.metrics?.words || 0 : 0), label: carriedLabel, optionId: carriedOptionId });
    }
  }
  return results;
}

function buildDecisionEdges(model, selected) {
  const occurrenceToLogical = new Map();
  selected.forEach(decision => decision.occurrences.forEach(occurrence => occurrenceToLogical.set(occurrence.id, decision.id)));
  const visiblePhysical = new Set(model.endings.map(ending => ending.id));
  const edges = [];
  const startScene = model.sceneNodes.find(node => node.start);
  if (startScene) traverseToVisible(model, startScene.id, occurrenceToLogical, visiblePhysical).forEach(result => edges.push({ from: 'decision-start', ...result, kind: result.label ? 'option' : 'sequence' }));
  selected.forEach(decision => {
    decision.occurrences.forEach(occurrence => traverseToVisible(model, occurrence.id, occurrenceToLogical, visiblePhysical).forEach(result => { if (result.to !== decision.id) edges.push({ from: decision.id, ...result, kind: result.label ? 'option' : 'sequence' }); }));
  });
  return collapseParallelOptionEdges(aggregatePresentationEdges(edges));
}

export function createDecisionPresentation(model, options = {}) {
  const scope = options.decisionScope || (model.decisions.some(decision => decision.mainLattice) ? 'main' : 'all');
  let selected = decisionScopeFilter(model, scope);
  const search = String(options.search || '').trim().toLowerCase();
  if (search) selected = [...new Map([...selected, ...model.decisions.filter(decision => `${decision.choiceId} ${decision.title} ${decision.fragmentIds?.join(' ') || ''} ${decision.occurrences.map(item => item.sceneId).join(' ')}`.toLowerCase().includes(search))].map(item => [item.choiceId, item])).values()];
  selected = selectDistributed(selected, Number(options.maxNodes || 30), decision => decision.chapterTitles[0] || 'Другие', decision => (decision.influencesEnding ? 30 : 0) + (decision.repeated ? 14 : 0) + decision.optionCount * 4 + decision.affectedSceneIds.length).sort((a, b) => a.firstOrder - b.firstOrder);
  const startScene = model.sceneNodes.find(node => node.start);
  const start = { id: 'decision-start', kind: 'start', title: startScene?.title || 'Начало', sceneId: startScene?.sceneId || null, chapterTitle: startScene?.chapterTitle || model.chapterOrder[0], order: -1, metrics: startScene?.metrics || { scenes: 1, frames: 0, words: 0 } };
  return { viewType: 'decisions', title: 'Карта решений', nodes: [start, ...selected.map(decisionNode), ...model.endings.map(endingNode)], edges: buildDecisionEdges(model, selected), columns: ['Начало', 'Ранние решения', 'Развитие', 'Перелом', 'Поздние решения', 'Финалы'], metadata: { scope, logicalDecisions: selected.length, occurrences: sum(selected, decision => decision.occurrenceCount), allLogicalDecisions: model.decisions.length, mainLatticeCount: model.decisions.filter(decision => decision.mainLattice).length } };
}

export function parseReviewRoute(route) {
  const raw = String(route?.choices || route?.path || '');
  const tokens = raw.split(/\s*→\s*/).map(item => item.trim()).filter(Boolean).map(item => {
    const match = item.match(/^((?:C\d{2}|FINAL|E\d(?:_[A-Z]+)?))(?:[-:]([A-Z*]|any))?/i);
    return match ? { raw: item, decisionId: match[1].toUpperCase(), optionId: match[2] && !/^any$/i.test(match[2]) ? match[2].toUpperCase() : '*' } : null;
  }).filter(Boolean);
  return { id: route.id, name: route.name || route.id, purpose: route.purpose || '', tokens, raw };
}

function reviewRoutePresentation(model, options = {}) {
  const routes = model.reviewRoutes.map(parseReviewRoute);
  const selectedRouteId = options.reviewRouteId || 'all';
  const active = selectedRouteId === 'all' ? routes : routes.filter(route => route.id === selectedRouteId);
  const decisions = new Map(model.decisions.map(decision => [decision.choiceId, decision]));
  const nodes = new Map([['route-start', { id: 'route-start', kind: 'start', title: 'Начало', order: -1, metrics: { scenes: 1, frames: 0, words: 0 } }]]);
  const edges = new Map();
  active.forEach(route => {
    let previous = 'route-start';
    route.tokens.forEach((token, index) => {
      const final = token.decisionId === 'FINAL';
      const id = final ? `review-final:${token.optionId}` : `review:${token.decisionId}`;
      const decision = decisions.get(token.decisionId);
      if (!nodes.has(id)) nodes.set(id, final ? { id, kind: 'routeFinal', endingId: token.optionId, title: token.optionId === '*' ? 'Любой финал' : `Финал ${token.optionId}`, order: 1000 + index, metrics: { scenes: 0, frames: 0, words: 0 } } : { id, kind: 'logicalDecision', decisionId: token.decisionId, choiceId: token.decisionId, title: decision?.title || token.decisionId, order: decision?.firstOrder ?? index, chapterTitle: decision?.chapterTitles?.[0] || 'Маршрут', options: decision?.options || [], occurrenceCount: decision?.occurrenceCount || 0, optionCount: decision?.optionCount || 0, metrics: decision?.metrics || {} });
      const key = `${previous}|${id}|${token.optionId}`;
      if (!edges.has(key)) edges.set(key, { from: previous, to: id, kind: 'route', label: token.optionId === '*' ? '' : token.optionId, routeIds: [], routeCount: 0, hiddenScenes: 0, hiddenFrames: 0, hiddenWords: 0 });
      const edge = edges.get(key); edge.routeIds.push(route.id); edge.routeCount++;
      previous = id;
    });
  });
  return { viewType: 'routes', title: 'Анализ путей', nodes: [...nodes.values()], edges: [...edges.values()].map(edge => ({ ...edge, routeIds: uniq(edge.routeIds) })), columns: ['Старт', 'Ранний путь', 'Развитие', 'Перелом', 'Финальный путь', 'Финалы'], reviewRoutes: routes, metadata: { mode: 'review', routeCount: active.length, allRouteCount: routes.length, selectedRouteId, showEdgeLabels: true } };
}

function structuralRoutePresentation(model, options = {}) {
  const decisions = createDecisionPresentation(model, { ...options, decisionScope: options.decisionScope || (model.decisions.some(decision => decision.mainLattice) ? 'main' : 'all'), maxNodes: 22 });
  let edges = collapseParallelOptionEdges(decisions.edges.map(edge => ({ ...edge, kind: 'flow' })));
  const mode = options.weightMode || 'scenes';
  const value = edge => mode === 'words' ? edge.hiddenWords : mode === 'frames' ? edge.hiddenFrames : Math.max(1, edge.hiddenScenes || edge.count || 1);
  const total = sum(edges, value) || 1;
  const threshold = options.hideSmall ? Number(options.minShare || .02) : 0;
  edges = edges.filter(edge => value(edge) / total >= threshold || edge.to.startsWith('ending:'));
  const used = new Set(['decision-start']); edges.forEach(edge => { used.add(edge.from); used.add(edge.to); });
  return { ...decisions, viewType: 'routes', title: 'Анализ путей', nodes: decisions.nodes.filter(node => used.has(node.id)), edges, reviewRoutes: model.reviewRoutes.map(parseReviewRoute), metadata: { mode: 'structural', corridorCount: edges.length, routeFamilyCount: Math.min(12, Math.max(model.endings.length, edges.length)), hiddenSmall: decisions.edges.length - edges.length, minShare: threshold, showEdgeLabels: false } };
}

export function createRoutePresentation(model, options = {}) {
  if (options.routeMode === 'review' && model.reviewRoutes.length) return reviewRoutePresentation(model, options);
  return structuralRoutePresentation(model, options);
}

function densityBins(scenes, metric = 'events', count = 12) {
  const bins = Array(count).fill(0);
  if (!scenes.length) return bins;
  scenes.forEach((scene, index) => {
    const bin = Math.min(count - 1, Math.floor(index / scenes.length * count));
    const value = metric === 'words' ? scene.words : metric === 'choices' ? scene.occurrences.length : metric === 'reviews' ? scene.metrics.reviews || 0 : 1 + scene.occurrences.length * 2 + (scene.branchMarkers ? 1 : 0);
    bins[bin] += value;
  });
  const max = Math.max(1, ...bins); return bins.map(value => value / max);
}

function novelGroups(model, groupMode = 'auto') {
  if (groupMode === 'chapters' || (groupMode === 'auto' && !model.sourceGraph)) return model.chapterOrder.map((title, index) => ({ id: `chapter:${title}`, title, order: index, sceneIds: model.sceneRecords.filter(scene => scene.chapterTitle === title).map(scene => scene.id) }));
  return model.structuralGroups.map(group => ({ id: `block:${group.id}`, title: group.title, order: group.order, sceneIds: model.sceneRecords.filter(scene => scene.structuralGroupId === group.id).map(scene => scene.id) }));
}

export function createNovelPresentation(model, options = {}) {
  const groups = novelGroups(model, options.groupMode || 'auto');
  const nodes = groups.map(group => {
    const scenes = group.sceneIds.map(id => model.sceneById.get(id)).filter(Boolean);
    const decisions = model.decisions.filter(decision => decision.occurrences.some(occurrence => group.sceneIds.includes(occurrence.sceneId)));
    const { incoming, outgoing } = indexStoryGraph(model.nodes, model.edges);
    const branchCount = decisions.length;
    const mergeCount = scenes.filter(scene => (incoming.get(sceneNodeId(scene.id))?.length || 0) > 1).length;
    return { id: group.id, kind: 'structuralBlock', title: group.title, order: group.order, sceneId: scenes[0]?.id || null, sourceSceneIds: group.sceneIds, fragmentIds: uniq(scenes.flatMap(scene => scene.fragmentIds || [])), metrics: { ...aggregateMetrics(scenes), scenes: scenes.length, choices: decisions.length, branches: branchCount, merges: mergeCount }, density: densityBins(scenes, options.densityMetric || 'events'), keyPoints: uniq([decisions[0]?.title, decisions.at(-1)?.title]).filter(Boolean) };
  });
  const edges = nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1].id, kind: 'sequence' }));
  return { viewType: 'novel', title: 'Карта романа', nodes, edges, metadata: { groupMode: options.groupMode || 'auto', densityMetric: options.densityMetric || 'events', groups: nodes.length, totalScenes: model.sceneRecords.length, totalWords: sum(model.sceneRecords, scene => scene.words), decisions: model.decisions.length, endings: model.endings.length } };
}

export function createPresentation(model, options = {}) {
  if (options.viewType === 'decisions') return createDecisionPresentation(model, options);
  if (options.viewType === 'routes') return createRoutePresentation(model, options);
  if (options.viewType === 'novel') return createNovelPresentation(model, options);
  return createStorylinePresentation(model, options);
}

export function consequenceSet(model, decisionId, optionId = null) {
  const decision = model.decisions.find(item => item.id === decisionId || item.choiceId === decisionId);
  if (!decision) return new Set();
  const keep = new Set([decision.id]);
  decision.occurrences.forEach(occurrence => keep.add(occurrence.id));
  decision.affectedDecisionIds.forEach(id => keep.add(`decision:${id}`));
  decision.affectedSceneIds.forEach(id => keep.add(sceneNodeId(id)));
  model.endings.forEach(ending => { if (decision.influencesEnding || decision.choiceId === 'FINAL') keep.add(ending.id); });
  if (optionId) decision.options.filter(option => option.id === optionId).forEach(option => option.occurrences?.forEach(id => keep.add(id)));
  return keep;
}

export function presentationStats(presentation) {
  return { nodes: presentation.nodes.length, edges: presentation.edges.length, scenes: sum(presentation.nodes, node => node.metrics?.scenes), frames: sum(presentation.nodes, node => node.metrics?.frames), words: sum(presentation.nodes, node => node.metrics?.words) };
}
