import { escapeHtml, sceneFrameMetrics } from './heartline-domain.js';

/*
 * HEARTLINE Story Graph 2.1
 * One normalized graph model + four purpose-built renderers:
 *  - Chapter map
 *  - Decision map
 *  - Route analysis
 *  - Novel map
 */

const ROUTE_META = {
  common:  { label: 'Общая линия', order: 0, color: '#5f6360', soft: '#f0f1ef' },
  equal:   { label: 'На равных', order: 1, color: '#5b78d6', soft: '#eef2ff' },
  fire:    { label: 'Игра с огнём', order: 2, color: '#e47a36', soft: '#fff1e8' },
  mask:    { label: 'Без масок', order: 3, color: '#8a62d3', soft: '#f4efff' },
  direct:  { label: 'Прямой маршрут', order: 4, color: '#299177', soft: '#eaf8f4' },
  oath:    { label: 'Старая Клятва', order: 5, color: '#8a6a3e', soft: '#f8f1e7' },
  network: { label: 'Новая сеть', order: 6, color: '#2f7f9c', soft: '#eaf6fa' },
  break:   { label: 'Разрыв', order: 7, color: '#b25065', soft: '#fbecef' }
};

const MAX_CHAPTER_NODES = 20;
const MAX_DECISION_NODES = 18;
const DECISION_COLUMNS = 6;

function countWords(value) {
  return (String(value || '').trim().match(/[\p{L}\p{N}’'-]+/gu) || []).length;
}

function walkSteps(steps, visitor) {
  for (const step of steps || []) {
    visitor(step);
    if (step?.type === 'choice') {
      for (const option of step.options || []) walkSteps(option.steps || [], visitor);
    }
  }
}

function sceneWordCount(scene) {
  let words = 0;
  walkSteps(scene?.steps || [], step => {
    if (step?.type === 'choice') {
      words += countWords(step.prompt);
      for (const option of step.options || []) words += countWords(option.label);
    } else if (step?.type !== 'tech') {
      words += countWords(step?.text);
    }
  });
  return words;
}

function optionTarget(option) {
  if (option?.goto) return option.goto;
  if (option?.fallbackGoto) return option.fallbackGoto;
  let found = null;
  walkSteps(option?.steps || [], step => {
    if (!found && step?.type === 'tech' && step.command === 'GOTO') found = step.value;
  });
  return found;
}

function sceneLevelGotos(scene) {
  return (scene?.steps || [])
    .filter(step => step?.type === 'tech' && step.command === 'GOTO')
    .map(step => step.value)
    .filter(Boolean);
}

function sceneEnds(scene) {
  if (scene?.finalRoute) return true;
  let result = false;
  walkSteps(scene?.steps || [], step => {
    if (step?.type === 'tech' && step.command === 'SYSTEM' && /^END(?:\s+ROUTE_|\b)/i.test(String(step.value || ''))) result = true;
  });
  return result;
}

function routeKey(sceneId = '') {
  const id = String(sceneId).toUpperCase();
  if (/(?:^|_)EQUAL(?:_|$)/.test(id)) return 'equal';
  if (/(?:^|_)FIRE(?:_|$)/.test(id)) return 'fire';
  if (/(?:^|_)MASK(?:_|$)/.test(id)) return 'mask';
  if (/(?:^|_)DIRECT(?:_|$)/.test(id)) return 'direct';
  return 'common';
}

function sceneRouteKey(scene) {
  if (scene?.finalRoute === 'A') return 'oath';
  if (scene?.finalRoute === 'B') return 'network';
  if (scene?.finalRoute === 'C') return 'break';
  return routeKey(scene?.id || '');
}

function resolveDynamicTargets(raw, sceneIds) {
  const value = String(raw || '').trim().replace(/[.;]+$/, '');
  if (!value) return [];
  if (sceneIds.has(value)) return [value];

  // Backward-compatible aliases used by earlier HEARTLINE packages.
  if (/соответствующая маршрутная сцена/i.test(value)) {
    return ['CH03_SC03_EQUAL', 'CH03_SC03_FIRE', 'CH03_SC03_MASK'].filter(id => sceneIds.has(id));
  }
  if (/согласно\s+ROUTE_ID/i.test(value)) {
    return ['CH06_SC04_DIRECT', 'CH06_SC05_EQUAL', 'CH06_SC05_FIRE', 'CH06_SC05_MASK'].filter(id => sceneIds.has(id));
  }

  // Tolerate "GOTO SOME_ID" style values.
  const cleaned = value.replace(/^GOTO\s+/i, '').trim();
  if (sceneIds.has(cleaned)) return [cleaned];
  return [];
}

function choiceSignificant(step) {
  const options = step?.options || [];
  const targets = new Set();
  let stateful = false;

  for (const option of options) {
    const target = optionTarget(option);
    if (target) targets.add(String(target));
    if (option?.condition) stateful = true;
    walkSteps(option?.steps || [], item => {
      if (item?.type === 'tech' && ['SET', 'GOTO', 'IF'].includes(item.command)) stateful = true;
    });
  }
  return stateful || targets.size > 1;
}

function chapterOrderFromScenes(scenes) {
  const result = [];
  for (const scene of scenes) {
    const title = scene.chapterTitle || 'Другие';
    if (!result.includes(title)) result.push(title);
  }
  return result;
}

export function buildGraph(content, assignments = [], reviews = []) {
  const scenes = content?.scenes || [];
  const sceneIds = new Set(scenes.map(scene => scene.id));
  const sceneIndex = new Map(scenes.map((scene, index) => [scene.id, index]));
  const nodes = [];
  const edges = [];
  const chapterOrder = chapterOrderFromScenes(scenes);

  const metadataFinals = Array.isArray(content?.storyMetadata?.finals)
    ? content.storyMetadata.finals
    : Array.isArray(content?.finals)
      ? content.finals
      : [];

  const finalMap = new Map(metadataFinals.map((item, index) => [
    String(item?.id || String.fromCharCode(65 + index)).toUpperCase(),
    item
  ]));

  // Scene and Choice nodes.
  for (const scene of scenes) {
    const order = sceneIndex.get(scene.id) || 0;
    const metrics = {
      ...sceneFrameMetrics(content, scene.id, assignments, reviews),
      words: sceneWordCount(scene)
    };

    nodes.push({
      id: `scene:${scene.id}`,
      kind: 'scene',
      sceneId: scene.id,
      title: scene.title || scene.id,
      chapterTitle: scene.chapterTitle || 'Другие',
      start: scene.id === content.startScene,
      end: sceneEnds(scene),
      finalRoute: scene.finalRoute || null,
      metrics,
      routeKey: sceneRouteKey(scene),
      order
    });

    const topChoices = (scene.steps || []).filter(step => step?.type === 'choice');
    topChoices.forEach((step, choiceIndex) => {
      nodes.push({
        id: `choice:${scene.id}:${step.id || choiceIndex}`,
        kind: 'choice',
        sceneId: scene.id,
        choiceId: step.id || `choice-${choiceIndex + 1}`,
        title: step.prompt || step.id || 'Решение',
        chapterTitle: scene.chapterTitle || 'Другие',
        routeKey: sceneRouteKey(scene),
        order: order + .3 + choiceIndex * .08,
        optionCount: (step.options || []).length,
        significant: choiceSignificant(step)
      });
    });
  }

  // Metadata ending nodes.
  if (metadataFinals.length) {
    const finalChapter = chapterOrder.at(-1) || 'Финалы';
    metadataFinals.forEach((item, index) => {
      const endingId = String(item?.id || String.fromCharCode(65 + index)).toUpperCase();
      nodes.push({
        id: `ending:${endingId}`,
        kind: 'ending',
        endingId,
        sceneId: null,
        title: item?.title || item?.name || `Финал ${endingId}`,
        chapterTitle: finalChapter,
        start: false,
        end: true,
        metrics: { scenes: 0, frames: 0, words: 0, reviews: 0, missing: 0, approved: 0 },
        routeKey: endingId === 'A' ? 'oath' : endingId === 'B' ? 'network' : endingId === 'C' ? 'break' : 'common',
        order: scenes.length + 1 + index
      });
    });
  }

  const endingNodeIds = new Set(nodes.filter(node => node.kind === 'ending').map(node => node.id));

  // Scene transitions and choices.
  for (const scene of scenes) {
    const order = sceneIndex.get(scene.id) || 0;
    const topChoices = (scene.steps || []).filter(step => step?.type === 'choice');
    const nextScene = scenes[order + 1] || null;
    const sceneNodeId = `scene:${scene.id}`;

    if (topChoices.length) {
      const firstChoice = topChoices[0];
      edges.push({
        from: sceneNodeId,
        to: `choice:${scene.id}:${firstChoice.id || 0}`,
        kind: 'choice-enter'
      });

      topChoices.forEach((step, choiceIndex) => {
        const choiceId = `choice:${scene.id}:${step.id || choiceIndex}`;
        const nextChoice = topChoices[choiceIndex + 1];

        for (const option of step.options || []) {
          const explicitTargets = resolveDynamicTargets(optionTarget(option), sceneIds);
          if (explicitTargets.length) {
            explicitTargets.forEach(target => edges.push({
              from: choiceId,
              to: `scene:${target}`,
              kind: 'option',
              label: option.label || option.id || 'Вариант',
              optionId: option.id || null
            }));
            continue;
          }

          const optionKey = String(option.id || '').toUpperCase();
          const finalMeta = finalMap.get(optionKey);
          const routeScene = finalMeta
            ? scenes.find(candidate => String(candidate.finalRoute || '').toUpperCase() === optionKey)
            : null;

          if (finalMeta && (routeScene || endingNodeIds.has(`ending:${optionKey}`))) {
            edges.push({
              from: choiceId,
              to: routeScene ? `scene:${routeScene.id}` : `ending:${optionKey}`,
              kind: 'option',
              label: option.label || finalMeta.title || `Финал ${optionKey}`,
              optionId: option.id || optionKey
            });
            continue;
          }

          if (nextChoice) {
            edges.push({
              from: choiceId,
              to: `choice:${scene.id}:${nextChoice.id || choiceIndex + 1}`,
              kind: 'option',
              label: option.label || option.id || 'Вариант',
              optionId: option.id || null,
              reconverges: true
            });
          } else if (nextScene && !sceneEnds(scene)) {
            edges.push({
              from: choiceId,
              to: `scene:${nextScene.id}`,
              kind: 'option',
              label: option.label || option.id || 'Вариант',
              optionId: option.id || null,
              reconverges: true
            });
          }
        }
      });
      continue;
    }

    const gotos = [...new Set(sceneLevelGotos(scene).flatMap(raw => resolveDynamicTargets(raw, sceneIds)))];
    if (gotos.length) {
      gotos.forEach(target => edges.push({ from: sceneNodeId, to: `scene:${target}`, kind: 'goto' }));
      continue;
    }

    if (scene.finalRoute) {
      const routeKeyId = String(scene.finalRoute).toUpperCase();
      const nextRouteScene = scenes.slice(order + 1).find(candidate => candidate.finalRoute === scene.finalRoute);
      if (nextRouteScene) {
        edges.push({ from: sceneNodeId, to: `scene:${nextRouteScene.id}`, kind: 'sequence' });
      } else if (endingNodeIds.has(`ending:${routeKeyId}`)) {
        edges.push({ from: sceneNodeId, to: `ending:${routeKeyId}`, kind: 'ending' });
      }
      continue;
    }

    if (!sceneEnds(scene) && nextScene) {
      edges.push({ from: sceneNodeId, to: `scene:${nextScene.id}`, kind: 'sequence' });
    }
  }

  // If a final-route scene is terminal, ensure it reaches its metadata ending.
  for (const scene of scenes.filter(item => item.finalRoute)) {
    const key = String(scene.finalRoute).toUpperCase();
    const routeScenes = scenes.filter(item => item.finalRoute === scene.finalRoute);
    const last = routeScenes.at(-1);
    if (last?.id === scene.id && endingNodeIds.has(`ending:${key}`)) {
      const exists = edges.some(edge => edge.from === `scene:${scene.id}` && edge.to === `ending:${key}`);
      if (!exists) edges.push({ from: `scene:${scene.id}`, to: `ending:${key}`, kind: 'ending' });
    }
  }

  return { nodes, edges, chapterOrder };
}

function graphIndex(model) {
  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  const incoming = new Map(model.nodes.map(node => [node.id, []]));
  const outgoing = new Map(model.nodes.map(node => [node.id, []]));
  for (const edge of model.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    incoming.get(edge.to).push(edge);
    outgoing.get(edge.from).push(edge);
  }
  return { nodeById, incoming, outgoing };
}

function nodeSearchText(node) {
  return `${node.sceneId || ''} ${node.choiceId || ''} ${node.endingId || ''} ${node.title || ''} ${node.chapterTitle || ''}`.toLowerCase();
}

function nodeMatches(node, filter, search, visitedSceneIds = new Set()) {
  const q = String(search || '').trim().toLowerCase();
  if (q && !nodeSearchText(node).includes(q)) return false;
  if (filter === 'decisions') return node.kind === 'choice';
  if (filter === 'unread') return node.kind === 'scene' && !visitedSceneIds.has(node.sceneId);
  if (filter === 'missing') return node.kind === 'scene' && !!node.metrics?.missing;
  if (filter === 'reviews') return node.kind === 'scene' && !!node.metrics?.reviews;
  if (filter === 'endings') return node.kind === 'ending' || node.end;
  return true;
}

function nodeDimmed(node, options, focusSet = null) {
  if (focusSet && !focusSet.has(node.id)) return true;
  const filterActive = options.filter && options.filter !== 'all';
  const q = String(options.search || '').trim();
  if ((filterActive || q) && !nodeMatches(node, options.filter || 'all', options.search || '', options.visitedSceneIds || new Set())) return true;
  return false;
}

function graphFocusSet(model, sceneId) {
  if (!sceneId) return null;
  const starts = model.nodes.filter(node => node.sceneId === sceneId).map(node => node.id);
  if (!starts.length) return null;
  const { incoming, outgoing } = graphIndex(model);
  const keep = new Set(starts);

  const traverse = (map, forward) => {
    const stack = [...starts];
    while (stack.length) {
      const id = stack.pop();
      for (const edge of map.get(id) || []) {
        const next = forward ? edge.to : edge.from;
        if (keep.has(next)) continue;
        keep.add(next);
        stack.push(next);
      }
    }
  };
  traverse(incoming, false);
  traverse(outgoing, true);
  return keep;
}

function edgeMetric(node) {
  if (!node || node.kind !== 'scene') return { scenes: 0, frames: 0, words: 0 };
  return {
    scenes: 1,
    frames: node.metrics?.frames || 0,
    words: node.metrics?.words || 0
  };
}

/**
 * Collapse hidden linear content between visible nodes.
 * Keeps first Choice label and accumulates content volume for edge badges/Sankey.
 */
function compressedEdges(model, visible, restrict = null) {
  const { nodeById, outgoing } = graphIndex(model);
  const result = [];
  const seen = new Set();

  function walk(sourceId, edge, aggregate, carried, visited) {
    if (visited.has(edge.to)) return;
    if (restrict && !restrict.has(edge.to) && !visible.has(edge.to)) return;

    const nextVisited = new Set(visited);
    nextVisited.add(edge.to);

    const optionLabel = carried.label || (edge.kind === 'option' ? edge.label || '' : '');
    const optionId = carried.optionId || (edge.kind === 'option' ? edge.optionId || null : null);

    if (visible.has(edge.to)) {
      const key = `${sourceId}|${edge.to}|${optionId || ''}|${optionLabel}`;
      if (!seen.has(key) && sourceId !== edge.to) {
        seen.add(key);
        result.push({
          from: sourceId,
          to: edge.to,
          kind: optionLabel || optionId ? 'option' : edge.kind,
          label: optionLabel,
          optionId,
          hiddenScenes: aggregate.scenes,
          hiddenFrames: aggregate.frames,
          hiddenWords: aggregate.words
        });
      }
      return;
    }

    const hidden = edgeMetric(nodeById.get(edge.to));
    const nextAggregate = {
      scenes: aggregate.scenes + hidden.scenes,
      frames: aggregate.frames + hidden.frames,
      words: aggregate.words + hidden.words
    };

    for (const next of outgoing.get(edge.to) || []) {
      walk(sourceId, next, nextAggregate, { label: optionLabel, optionId }, nextVisited);
    }
  }

  for (const sourceId of visible) {
    for (const edge of outgoing.get(sourceId) || []) {
      walk(sourceId, edge, { scenes: 0, frames: 0, words: 0 }, { label: '', optionId: null }, new Set([sourceId]));
    }
  }
  return result;
}

function svgEl(svg, tag, attrs = {}) {
  const el = document.createElementNS(svg.namespaceURI, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== '') el.setAttribute(key, String(value));
  }
  return el;
}

function createSvg(width, height, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.classList.add('story-graph-svg', className);

  const defs = svgEl(svg, 'defs');
  defs.innerHTML = `
    <marker id="graph2-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"></path>
    </marker>
  `;
  svg.append(defs);
  return svg;
}

function routeClassForEdge(edge, model) {
  const { nodeById } = graphIndex(model);
  const source = nodeById.get(edge.from);
  const target = nodeById.get(edge.to);
  const key = target?.routeKey && target.routeKey !== 'common'
    ? target.routeKey
    : source?.routeKey || 'common';
  return `route-${key}`;
}

function makeNodeGroup(svg, node, position, options = {}) {
  const classes = ['graph-node', node.kind, `route-${node.routeKey || 'common'}`];
  if (node.start) classes.push('start');
  if (node.end || node.kind === 'ending') classes.push('end');
  if (node.sceneId === options.currentSceneId) classes.push('current');
  if (node.id === options.selectedNodeId) classes.push('selected');
  if (options.visitedSceneIds?.has?.(node.sceneId)) classes.push('visited');
  if (node.metrics?.reviews) classes.push('has-reviews');
  if (options.matched) classes.push('matched');
  if (options.dimmed) classes.push('dimmed');
  if (options.compact) classes.push('compact');

  const g = svgEl(svg, 'g', {
    transform: `translate(${position.x},${position.y})`,
    class: classes.join(' ')
  });
  g.dataset.nodeId = node.id;
  g.dataset.x = position.x;
  g.dataset.y = position.y;
  g.dataset.w = position.width;
  g.dataset.h = position.height;

  const title = svgEl(svg, 'title');
  title.textContent = `${node.kind === 'choice' ? 'Решение' : node.kind === 'ending' ? 'Финал' : node.sceneId || 'Глава'}: ${node.title}`;
  g.append(title);

  g.append(svgEl(svg, 'rect', {
    width: position.width,
    height: position.height,
    rx: node.kind === 'choice' ? 14 : 11
  }));

  const fo = svgEl(svg, 'foreignObject', {
    width: position.width,
    height: position.height
  });
  const meta = node.kind === 'scene'
    ? `${node.metrics?.frames || 0} кадров${node.metrics?.reviews ? ` · ${node.metrics.reviews} замеч.` : ''}`
    : node.kind === 'ending'
      ? 'КОНЦОВКА'
      : node.kind === 'chapter'
        ? `${node.metrics?.scenes || 0} сцен · ${node.metrics?.choices || 0} решений`
        : `${node.choiceId || ''}${node.significant ? ' · значимое' : ''}`;

  fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="graph-node-copy">
    <span>${escapeHtml(node.kind === 'choice' ? 'РЕШЕНИЕ' : node.kind === 'ending' ? 'ФИНАЛ' : node.kind === 'chapter' ? 'ГЛАВА' : node.sceneId || '')}</span>
    <strong>${escapeHtml(node.title)}</strong>
    <small>${escapeHtml(meta)}</small>
  </div>`;
  g.append(fo);

  g.addEventListener('click', event => {
    event.stopPropagation();
    options.onSelect?.(node);
  });
  g.addEventListener('dblclick', event => {
    event.stopPropagation();
    if (node.sceneId) options.onOpen?.(node);
  });
  return g;
}

function edgeLabel(edge, mode = 'scenes') {
  if (edge.label) return edge.label;
  const value = mode === 'words'
    ? edge.hiddenWords
    : mode === 'frames'
      ? edge.hiddenFrames
      : edge.hiddenScenes;
  if (!value) return '';
  if (mode === 'words') return `${Number(value).toLocaleString('ru-RU')} слов`;
  if (mode === 'frames') return `${value} кадров`;
  return `${value} сцен`;
}

function curvePath(from, to, laneOffset = 0) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2 + laneOffset;
  const x2 = to.x;
  const y2 = to.y + to.height / 2 + laneOffset;

  if (x2 >= x1) {
    const dx = Math.max(48, (x2 - x1) * .42);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }

  const lift = Math.min(y1, y2) - 70 - Math.abs(laneOffset);
  const right = x1 + 72 + Math.abs(laneOffset) * .25;
  const left = x2 - 72 - Math.abs(laneOffset) * .25;
  return `M${x1},${y1} C${right},${y1} ${right},${lift} ${right + 40},${lift} H${left - 40} C${left},${lift} ${left},${y2} ${x2},${y2}`;
}

function renderEdges(svg, edges, positions, model, {
  metric = 'scenes',
  sankey = false,
  labels = true
} = {}) {
  const layer = svgEl(svg, 'g', {
    class: sankey ? 'graph2-sankey-edges' : 'graph2-edges'
  });

  const values = edges.map(edge => {
    const target = model.nodes.find(node => node.id === edge.to);
    const base = metric === 'words'
      ? edge.hiddenWords
      : metric === 'frames'
        ? edge.hiddenFrames
        : edge.hiddenScenes;
    const endpoint = target?.kind === 'scene'
      ? metric === 'words'
        ? target.metrics?.words || 0
        : metric === 'frames'
          ? target.metrics?.frames || 0
          : 1
      : 0;
    return Math.max(1, (base || 0) + endpoint);
  });
  const maxValue = Math.max(1, ...values);

  edges.forEach((edge, index) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return;

    const routeClass = routeClassForEdge(edge, model);
    const value = values[index] || 1;
    const strokeWidth = sankey
      ? 6 + Math.sqrt(value / maxValue) * 25
      : edge.kind === 'option' ? 2.4 : 1.8;

    const samePairIndex = edges.slice(0, index).filter(item => item.from === edge.from && item.to === edge.to).length;
    const pairTotal = edges.filter(item => item.from === edge.from && item.to === edge.to).length;
    const laneOffset = pairTotal > 1 ? (samePairIndex - (pairTotal - 1) / 2) * 11 : 0;

    const path = svgEl(svg, 'path', {
      d: curvePath(from, to, laneOffset),
      class: `graph2-edge ${edge.kind} ${routeClass}${sankey ? ' sankey' : ''}`,
      'stroke-width': strokeWidth,
      'marker-end': sankey ? null : 'url(#graph2-arrow)',
      'data-edge-from': edge.from,
      'data-edge-to': edge.to
    });

    const title = svgEl(svg, 'title');
    title.textContent = `${edge.label || 'Переход'}${edge.hiddenScenes ? ` · скрыто сцен: ${edge.hiddenScenes}` : ''}${edge.hiddenWords ? ` · слов: ${edge.hiddenWords}` : ''}`;
    path.append(title);
    layer.append(path);

    const text = edgeLabel(edge, metric);
    if (labels && text) {
      const label = svgEl(svg, 'text', {
        x: (from.x + from.width + to.x) / 2,
        y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 7 + laneOffset,
        class: `graph2-edge-label ${edge.kind}`
      });
      label.textContent = text.length > 42 ? `${text.slice(0, 40)}…` : text;
      layer.append(label);
    }
  });
  svg.append(layer);
}

function wireGraphHover(svg) {
  const nodes = [...svg.querySelectorAll('[data-node-id]')];
  const edges = [...svg.querySelectorAll('[data-edge-from][data-edge-to]')];

  const clear = () => {
    svg.classList.remove('graph-hover-mode');
    nodes.forEach(node => node.classList.remove('hover-related', 'hover-dim'));
    edges.forEach(edge => edge.classList.remove('hover-related', 'hover-dim'));
  };

  nodes.forEach(node => {
    node.addEventListener('mouseenter', () => {
      const id = node.dataset.nodeId;
      const related = new Set([id]);

      for (const edge of edges) {
        if (edge.dataset.edgeFrom === id || edge.dataset.edgeTo === id) {
          related.add(edge.dataset.edgeFrom);
          related.add(edge.dataset.edgeTo);
        }
      }

      svg.classList.add('graph-hover-mode');
      nodes.forEach(item => {
        const on = related.has(item.dataset.nodeId);
        item.classList.toggle('hover-related', on);
        item.classList.toggle('hover-dim', !on);
      });
      edges.forEach(edge => {
        const on = edge.dataset.edgeFrom === id || edge.dataset.edgeTo === id;
        edge.classList.toggle('hover-related', on);
        edge.classList.toggle('hover-dim', !on);
      });
    });
    node.addEventListener('mouseleave', clear);
  });
}

function distributeByStage(nodes, stageFor, {
  stageCount,
  left = 95,
  top = 112,
  columnGap = 235,
  rowGap = 104,
  nodeWidth = 176,
  choiceWidth = 208,
  endingWidth = 190,
  nodeHeight = 66
}) {
  const positions = new Map();
  const buckets = Array.from({ length: stageCount }, () => []);

  for (const node of nodes) {
    const stage = Math.max(0, Math.min(stageCount - 1, stageFor(node)));
    buckets[stage].push(node);
  }

  let maxRows = 1;
  buckets.forEach((items, stage) => {
    items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    maxRows = Math.max(maxRows, items.length);
    const columnHeight = Math.max(nodeHeight, (items.length - 1) * rowGap + nodeHeight);
    const globalHeight = Math.max(480, maxRows * rowGap + 140);
    const baseY = top + Math.max(0, (globalHeight - top - columnHeight) / 2);

    items.forEach((node, row) => {
      const width = node.kind === 'choice' ? choiceWidth : node.kind === 'ending' ? endingWidth : nodeWidth;
      positions.set(node.id, {
        x: left + stage * columnGap,
        y: baseY + row * rowGap,
        width,
        height: nodeHeight,
        stage
      });
    });
  });

  return {
    positions,
    width: Math.max(920, left * 2 + stageCount * columnGap + Math.max(choiceWidth, endingWidth)),
    height: Math.max(620, top * 2 + maxRows * rowGap + nodeHeight),
    buckets
  };
}

function chapterVisibleSet(model, chapterTitle, currentSceneId) {
  const { incoming, outgoing } = graphIndex(model);
  const chapterNodes = model.nodes.filter(node => node.chapterTitle === chapterTitle && node.kind !== 'ending');
  const visible = new Set();

  for (const node of chapterNodes) {
    if (node.kind === 'choice' || node.sceneId === currentSceneId || node.start || node.end) visible.add(node.id);
    if (node.kind === 'scene') {
      const inDegree = incoming.get(node.id)?.length || 0;
      const outDegree = outgoing.get(node.id)?.length || 0;
      if (inDegree !== 1 || outDegree !== 1) visible.add(node.id);
    }
  }

  const scenes = chapterNodes.filter(node => node.kind === 'scene').sort((a, b) => a.order - b.order);
  if (scenes[0]) visible.add(scenes[0].id);
  if (scenes.at(-1)) visible.add(scenes.at(-1).id);

  // Fill sparse chapters evenly so the local map remains useful.
  if (visible.size < 8) {
    const sampleCount = Math.min(12, chapterNodes.length);
    for (let i = 0; i < sampleCount; i++) {
      const index = Math.round(i * Math.max(0, chapterNodes.length - 1) / Math.max(1, sampleCount - 1));
      if (chapterNodes[index]) visible.add(chapterNodes[index].id);
    }
  }

  if (visible.size > MAX_CHAPTER_NODES) {
    const current = chapterNodes.find(node => node.sceneId === currentSceneId);
    const center = current?.order ?? scenes[Math.floor(scenes.length / 2)]?.order ?? 0;

    const mustKeep = chapterNodes.filter(node => node.kind === 'choice' || node.sceneId === currentSceneId || node.start || node.end);
    const nearby = chapterNodes
      .filter(node => visible.has(node.id) && !mustKeep.includes(node))
      .sort((a, b) => Math.abs(a.order - center) - Math.abs(b.order - center));

    visible.clear();
    [...mustKeep, ...nearby].slice(0, MAX_CHAPTER_NODES).forEach(node => visible.add(node.id));
  }

  return visible;
}

function renderChapterMap(host, model, options) {
  const selected = model.nodes.find(node => node.id === options.selectedNodeId)
    || model.nodes.find(node => node.sceneId === options.currentSceneId)
    || model.nodes.find(node => node.start)
    || model.nodes[0];

  const chapterTitle = selected?.chapterTitle || model.chapterOrder[0] || 'Глава';
  const visible = chapterVisibleSet(model, chapterTitle, options.currentSceneId);
  const restrict = new Set(model.nodes.filter(node => node.chapterTitle === chapterTitle).map(node => node.id));
  const nodes = model.nodes.filter(node => visible.has(node.id));
  const edges = compressedEdges(model, visible, restrict);

  const chapterNodes = model.nodes
    .filter(node => node.chapterTitle === chapterTitle && node.kind !== 'ending')
    .sort((a, b) => a.order - b.order);
  const minOrder = chapterNodes[0]?.order || 0;
  const maxOrder = chapterNodes.at(-1)?.order || minOrder + 1;
  const stageCount = Math.max(4, Math.min(8, Math.ceil(nodes.length / 2)));

  const geo = distributeByStage(
    nodes,
    node => {
      const ratio = (node.order - minOrder) / Math.max(.001, maxOrder - minOrder);
      return Math.round(ratio * (stageCount - 1));
    },
    { stageCount, left: 100, top: 120, columnGap: 245, rowGap: 98, nodeWidth: 185, choiceWidth: 218, nodeHeight: 66 }
  );

  const svg = createSvg(geo.width, geo.height, 'graph2-chapter-map');

  const banner = svgEl(svg, 'g', { class: 'graph2-chapter-banner' });
  banner.append(svgEl(svg, 'rect', { x: 24, y: 22, width: geo.width - 48, height: 58, rx: 14 }));
  const title = svgEl(svg, 'text', { x: 45, y: 57 });
  title.textContent = chapterTitle;
  banner.append(title);
  svg.append(banner);

  renderEdges(svg, edges, geo.positions, model, { metric: 'scenes', sankey: false, labels: true });

  const focusSet = options.focusSceneId ? graphFocusSet(model, options.focusSceneId) : null;
  const q = String(options.search || '').trim().toLowerCase();
  const nodeLayer = svgEl(svg, 'g', { class: 'graph2-nodes' });

  for (const node of nodes) {
    const pos = geo.positions.get(node.id);
    if (!pos) continue;
    nodeLayer.append(makeNodeGroup(svg, node, pos, {
      ...options,
      matched: !!q && nodeSearchText(node).includes(q),
      dimmed: nodeDimmed(node, options, focusSet)
    }));
  }
  svg.append(nodeLayer);

  wireGraphHover(svg);
  host.replaceChildren(svg);
  return svg;
}

function decisionVisibleSet(model) {
  const { incoming, outgoing } = graphIndex(model);
  const visible = new Set();

  const start = model.nodes.find(node => node.start && node.kind === 'scene');
  if (start) visible.add(start.id);

  model.nodes.filter(node => node.kind === 'ending').forEach(node => visible.add(node.id));
  model.nodes.filter(node => node.kind === 'scene' && node.end && !model.nodes.some(end => end.kind === 'ending')).forEach(node => visible.add(node.id));

  const choices = model.nodes
    .filter(node => node.kind === 'choice')
    .map(node => {
      const targets = new Set((outgoing.get(node.id) || []).map(edge => edge.to));
      const chapterIndex = Math.max(0, model.chapterOrder.indexOf(node.chapterTitle));
      const score =
        (node.significant ? 15 : 0) +
        (targets.size > 1 ? 12 : 0) +
        (String(node.choiceId).toUpperCase() === 'FINAL' ? 50 : 0) +
        (node.optionCount || 0) +
        chapterIndex * .01;
      return { node, score };
    });

  // Distribute strategic choices across the novel, rather than selecting
  // only the most complex cluster from one chapter.
  const chapters = model.chapterOrder;
  const perChapter = new Map();
  for (const item of choices) {
    if (!perChapter.has(item.node.chapterTitle)) perChapter.set(item.node.chapterTitle, []);
    perChapter.get(item.node.chapterTitle).push(item);
  }

  const picked = [];
  for (const chapter of chapters) {
    const best = (perChapter.get(chapter) || [])
      .sort((a, b) => b.score - a.score || a.node.order - b.node.order)
      .slice(0, 2);
    picked.push(...best);
  }

  picked
    .sort((a, b) => b.score - a.score || a.node.order - b.node.order)
    .slice(0, Math.max(6, MAX_DECISION_NODES - visible.size))
    .forEach(item => visible.add(item.node.id));

  choices
    .filter(item => String(item.node.choiceId).toUpperCase() === 'FINAL')
    .forEach(item => visible.add(item.node.id));

  // A few actual convergence scenes make the topology understandable.
  model.nodes
    .filter(node => node.kind === 'scene' && !node.start && !node.end && (incoming.get(node.id)?.length || 0) > 1)
    .sort((a, b) => (incoming.get(b.id)?.length || 0) - (incoming.get(a.id)?.length || 0) || a.order - b.order)
    .slice(0, 4)
    .forEach(node => visible.add(node.id));

  if (visible.size > MAX_DECISION_NODES) {
    const finals = [...visible].filter(id => model.nodes.find(node => node.id === id)?.end);
    const startIds = [...visible].filter(id => model.nodes.find(node => node.id === id)?.start);
    const rest = [...visible]
      .filter(id => !finals.includes(id) && !startIds.includes(id))
      .map(id => model.nodes.find(node => node.id === id))
      .filter(Boolean)
      .sort((a, b) => (b.kind === 'choice') - (a.kind === 'choice') || a.order - b.order)
      .slice(0, MAX_DECISION_NODES - finals.length - startIds.length);
    visible.clear();
    [...startIds, ...rest.map(node => node.id), ...finals].forEach(id => visible.add(id));
  }

  return visible;
}

function strategicStage(node, model, stageCount = DECISION_COLUMNS) {
  if (node.start) return 0;
  if (node.kind === 'ending' || node.end) return stageCount - 1;

  const chapterIndex = Math.max(0, model.chapterOrder.indexOf(node.chapterTitle));
  const chapterRatio = model.chapterOrder.length <= 1
    ? .5
    : chapterIndex / (model.chapterOrder.length - 1);

  return Math.max(1, Math.min(stageCount - 2, 1 + Math.round(chapterRatio * (stageCount - 3))));
}

function renderDecisionMap(host, model, options) {
  const visible = decisionVisibleSet(model);
  const nodes = model.nodes.filter(node => visible.has(node.id));
  const edges = compressedEdges(model, visible);

  const geo = distributeByStage(
    nodes,
    node => strategicStage(node, model, DECISION_COLUMNS),
    { stageCount: DECISION_COLUMNS, left: 105, top: 108, columnGap: 235, rowGap: 106, nodeWidth: 178, choiceWidth: 210, endingWidth: 190, nodeHeight: 68 }
  );

  const svg = createSvg(geo.width, geo.height, 'graph2-decision-map');

  const headers = svgEl(svg, 'g', { class: 'graph2-column-headers' });
  ['Начало', 'Ранние решения', 'Развитие', 'Перелом', 'Поздние решения', 'Финалы'].forEach((label, index) => {
    const x = 105 + index * 235;
    headers.append(svgEl(svg, 'line', { x1: x - 22, x2: x - 22, y1: 64, y2: geo.height - 28 }));
    const text = svgEl(svg, 'text', { x, y: 43 });
    text.textContent = label;
    headers.append(text);
  });
  svg.append(headers);

  renderEdges(svg, edges, geo.positions, model, { metric: 'scenes', labels: true });

  const focusSet = options.focusSceneId ? graphFocusSet(model, options.focusSceneId) : null;
  const q = String(options.search || '').trim().toLowerCase();
  const layer = svgEl(svg, 'g', { class: 'graph2-nodes' });

  for (const node of nodes) {
    const pos = geo.positions.get(node.id);
    if (!pos) continue;
    layer.append(makeNodeGroup(svg, node, pos, {
      ...options,
      compact: true,
      matched: !!q && nodeSearchText(node).includes(q),
      dimmed: nodeDimmed(node, options, focusSet)
    }));
  }
  svg.append(layer);

  wireGraphHover(svg);
  host.replaceChildren(svg);
  return svg;
}

function renderRouteAnalysis(host, model, options) {
  const visible = decisionVisibleSet(model);
  const nodes = model.nodes.filter(node => visible.has(node.id));
  const edges = compressedEdges(model, visible);

  const geo = distributeByStage(
    nodes,
    node => strategicStage(node, model, DECISION_COLUMNS),
    { stageCount: DECISION_COLUMNS, left: 110, top: 112, columnGap: 235, rowGap: 110, nodeWidth: 174, choiceWidth: 205, endingWidth: 188, nodeHeight: 66 }
  );

  const svg = createSvg(geo.width, Math.max(650, geo.height), 'graph2-route-analysis');
  const headers = svgEl(svg, 'g', { class: 'graph2-column-headers' });

  ['Старт', 'Ранний путь', 'Развитие', 'Перелом', 'Финальный путь', 'Финалы'].forEach((label, index) => {
    const text = svgEl(svg, 'text', { x: 110 + index * 235, y: 43 });
    text.textContent = label;
    headers.append(text);
  });
  svg.append(headers);

  renderEdges(svg, edges, geo.positions, model, {
    metric: options.weightMode || 'scenes',
    sankey: true,
    labels: true
  });

  const focusSet = options.focusSceneId ? graphFocusSet(model, options.focusSceneId) : null;
  const q = String(options.search || '').trim().toLowerCase();
  const layer = svgEl(svg, 'g', { class: 'graph2-nodes' });

  for (const node of nodes) {
    const pos = geo.positions.get(node.id);
    if (!pos) continue;
    layer.append(makeNodeGroup(svg, node, pos, {
      ...options,
      compact: true,
      matched: !!q && nodeSearchText(node).includes(q),
      dimmed: nodeDimmed(node, options, focusSet)
    }));
  }
  svg.append(layer);

  wireGraphHover(svg);
  host.replaceChildren(svg);
  return svg;
}

function chapterAggregate(model, chapterTitle) {
  const scenes = model.nodes.filter(node => node.kind === 'scene' && node.chapterTitle === chapterTitle);
  const choices = model.nodes.filter(node => node.kind === 'choice' && node.chapterTitle === chapterTitle);

  return {
    id: `chapter:${chapterTitle}`,
    kind: 'chapter',
    chapterTitle,
    title: chapterTitle,
    sceneId: scenes[0]?.sceneId || null,
    start: scenes.some(scene => scene.start),
    metrics: {
      scenes: scenes.length,
      choices: choices.length,
      frames: scenes.reduce((sum, node) => sum + (node.metrics?.frames || 0), 0),
      words: scenes.reduce((sum, node) => sum + (node.metrics?.words || 0), 0),
      reviews: scenes.reduce((sum, node) => sum + (node.metrics?.reviews || 0), 0),
      missing: scenes.reduce((sum, node) => sum + (node.metrics?.missing || 0), 0)
    },
    routeKey: 'common',
    order: scenes.length ? Math.min(...scenes.map(node => node.order)) : 0
  };
}

function chapterTransitions(model) {
  const { nodeById } = graphIndex(model);
  const map = new Map();

  for (const edge of model.edges) {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);
    if (!source || !target || !source.chapterTitle || !target.chapterTitle || source.chapterTitle === target.chapterTitle) continue;

    const key = `${source.chapterTitle}|${target.chapterTitle}`;
    const current = map.get(key) || { from: source.chapterTitle, to: target.chapterTitle, count: 0, choice: 0 };
    current.count++;
    if (edge.kind === 'option') current.choice++;
    map.set(key, current);
  }
  return [...map.values()];
}

function renderNovelMap(host, model, options) {
  const chapters = model.chapterOrder.map(chapter => chapterAggregate(model, chapter));
  const endings = model.nodes.filter(node => node.kind === 'ending');
  const width = 1450;
  const height = 930;
  const cx = 690;
  const cy = 465;
  const rx = 420;
  const ry = 315;
  const outerRx = 610;
  const outerRy = 365;

  const svg = createSvg(width, height, 'graph2-novel-map');
  const positions = new Map();

  chapters.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, chapters.length)) * Math.PI * 2;
    positions.set(node.id, {
      x: cx + Math.cos(angle) * rx - 92,
      y: cy + Math.sin(angle) * ry - 38,
      width: 184,
      height: 76,
      angle
    });
  });

  // Center start.
  const firstScene = model.nodes.find(node => node.start) || model.nodes.find(node => node.kind === 'scene');
  const center = svgEl(svg, 'g', {
    transform: `translate(${cx - 100},${cy - 45})`,
    class: 'graph2-novel-center graph-node start',
    'data-node-id': firstScene?.id || 'novel:start'
  });
  center.dataset.x = cx - 100;
  center.dataset.y = cy - 45;
  center.dataset.w = 200;
  center.dataset.h = 90;
  center.append(svgEl(svg, 'rect', { width: 200, height: 90, rx: 22 }));
  const centerFo = svgEl(svg, 'foreignObject', { width: 200, height: 90 });
  centerFo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="graph-node-copy">
    <span>НАЧАЛО ИСТОРИИ</span>
    <strong>${escapeHtml(firstScene?.title || 'Старт')}</strong>
    <small>${chapters.length} глав</small>
  </div>`;
  center.append(centerFo);
  if (firstScene) center.addEventListener('click', () => options.onSelect?.(firstScene));
  svg.append(center);

  // Center -> first chapter.
  if (chapters[0]) {
    const first = positions.get(chapters[0].id);
    const cx1 = cx;
    const cy1 = cy;
    const cx2 = first.x + first.width / 2;
    const cy2 = first.y + first.height / 2;
    const path = svgEl(svg, 'path', {
      d: `M${cx1},${cy1} Q${(cx1 + cx2) / 2},${(cy1 + cy2) / 2} ${cx2},${cy2}`,
      class: 'graph2-novel-edge primary'
    });
    svg.append(path);
  }

  const transitionLayer = svgEl(svg, 'g', { class: 'graph2-novel-edges' });
  const transitions = chapterTransitions(model);
  const maxCount = Math.max(1, ...transitions.map(item => item.count));

  for (const transition of transitions) {
    const from = positions.get(`chapter:${transition.from}`);
    const to = positions.get(`chapter:${transition.to}`);
    if (!from || !to) continue;

    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height / 2;
    const x2 = to.x + to.width / 2;
    const y2 = to.y + to.height / 2;
    const midAngle = Math.atan2((y1 + y2) / 2 - cy, (x1 + x2) / 2 - cx);
    const controlRadius = Math.min(rx, ry) * .64;
    const qx = cx + Math.cos(midAngle) * controlRadius;
    const qy = cy + Math.sin(midAngle) * controlRadius;

    const path = svgEl(svg, 'path', {
      d: `M${x1},${y1} Q${qx},${qy} ${x2},${y2}`,
      class: `graph2-novel-edge${transition.choice ? ' choice' : ''}`,
      'stroke-width': 1.2 + transition.count / maxCount * 2.2,
      'data-edge-from': `chapter:${transition.from}`,
      'data-edge-to': `chapter:${transition.to}`
    });
    const title = svgEl(svg, 'title');
    title.textContent = `Переходов между главами: ${transition.count}`;
    path.append(title);
    transitionLayer.append(path);
  }
  svg.append(transitionLayer);

  // Chapter nodes.
  const q = String(options.search || '').trim().toLowerCase();
  const currentChapter = model.nodes.find(node => node.sceneId === options.currentSceneId)?.chapterTitle;
  const layer = svgEl(svg, 'g', { class: 'graph2-nodes' });

  for (const node of chapters) {
    const pos = positions.get(node.id);
    const chapterSceneNodes = model.nodes.filter(item => item.chapterTitle === node.chapterTitle);
    const matchesSearch = !q || chapterSceneNodes.some(item => nodeSearchText(item).includes(q));
    const filterMatches = !options.filter || options.filter === 'all' || chapterSceneNodes.some(item => nodeMatches(item, options.filter, options.search, options.visitedSceneIds));
    const group = makeNodeGroup(svg, node, pos, {
      ...options,
      currentSceneId: node.chapterTitle === currentChapter ? node.sceneId : options.currentSceneId,
      selectedNodeId: options.selectedNodeId,
      matched: !!q && matchesSearch,
      dimmed: (!!q && !matchesSearch) || (options.filter && options.filter !== 'all' && !filterMatches)
    });
    group.classList.toggle('current', node.chapterTitle === currentChapter);
    layer.append(group);
  }
  svg.append(layer);

  // Endings on outer ring.
  const endingLayer = svgEl(svg, 'g', { class: 'graph2-ending-layer' });
  endings.forEach((node, index) => {
    const angle = Math.PI / 5 + (index / Math.max(1, endings.length - 1 || 1)) * Math.PI * .72;
    const pos = {
      x: cx + Math.cos(angle) * outerRx - 95,
      y: cy + Math.sin(angle) * outerRy - 34,
      width: 190,
      height: 68
    };
    positions.set(node.id, pos);
    endingLayer.append(makeNodeGroup(svg, node, pos, {
      ...options,
      compact: true,
      matched: !!q && nodeSearchText(node).includes(q),
      dimmed: nodeDimmed(node, options, options.focusSceneId ? graphFocusSet(model, options.focusSceneId) : null)
    }));
  });
  svg.append(endingLayer);

  // Connect chapters to endings using actual graph edges collapsed to ending.
  if (endings.length) {
    const finalVisible = new Set(endings.map(node => node.id));
    const strategic = decisionVisibleSet(model);
    const compressed = compressedEdges(model, new Set([...strategic, ...finalVisible]));
    const endingEdges = compressed.filter(edge => finalVisible.has(edge.to));
    const endingLinks = svgEl(svg, 'g', { class: 'graph2-novel-ending-links' });
    const nodeById = new Map(model.nodes.map(node => [node.id, node]));

    for (const edge of endingEdges) {
      const source = nodeById.get(edge.from);
      const endingPos = positions.get(edge.to);
      const chapterPos = source?.chapterTitle ? positions.get(`chapter:${source.chapterTitle}`) : null;
      if (!chapterPos || !endingPos) continue;

      const x1 = chapterPos.x + chapterPos.width / 2;
      const y1 = chapterPos.y + chapterPos.height / 2;
      const x2 = endingPos.x + endingPos.width / 2;
      const y2 = endingPos.y + endingPos.height / 2;
      endingLinks.append(svgEl(svg, 'path', {
        d: `M${x1},${y1} Q${(x1 + x2) / 2},${cy + 110} ${x2},${y2}`,
        class: `graph2-novel-ending-edge ${routeClassForEdge(edge, model)}`,
        'data-edge-from': `chapter:${source.chapterTitle}`,
        'data-edge-to': edge.to
      }));
    }
    svg.insertBefore(endingLinks, endingLayer);
  }

  wireGraphHover(svg);
  host.replaceChildren(svg);
  return svg;
}

export function layoutGraph(model) {
  // Kept as a stable API boundary. Renderers own their specialized layout.
  return { model };
}

export function renderGraph(host, model, _layout, options = {}) {
  const mode = options.viewMode || 'chapter';
  if (mode === 'decisions') return renderDecisionMap(host, model, options);
  if (mode === 'routes') return renderRouteAnalysis(host, model, options);
  if (mode === 'novel') return renderNovelMap(host, model, options);
  return renderChapterMap(host, model, options);
}

export function renderGraphOutline(host, model, {
  currentSceneId = null,
  selectedChapter = null,
  onSelect = null,
  onOpen = null
} = {}) {
  const currentNode = model.nodes.find(node => node.kind === 'scene' && node.sceneId === currentSceneId);
  const chapterToOpen = selectedChapter || currentNode?.chapterTitle || model.chapterOrder[0];

  host.innerHTML = model.chapterOrder.map(chapter => {
    const scenes = model.nodes
      .filter(node => node.kind === 'scene' && node.chapterTitle === chapter)
      .sort((a, b) => a.order - b.order);

    return `<details class="graph-outline-chapter" ${chapter === chapterToOpen ? 'open' : ''}>
      <summary><span>${escapeHtml(chapter)}</span><b>${scenes.length}</b></summary>
      <div class="graph-outline-list">
        ${scenes.map(scene => {
          const choices = model.nodes.filter(node => node.kind === 'choice' && node.sceneId === scene.sceneId);
          return `<div class="graph-outline-scene-wrap">
            <button class="graph-outline-scene ${scene.sceneId === currentSceneId ? 'active' : ''}" data-outline-node="${escapeHtml(scene.id)}">
              <span>${escapeHtml(scene.title)}</span>
              <small>${escapeHtml(scene.sceneId)}${scene.metrics?.reviews ? ` · ${scene.metrics.reviews} замеч.` : ''}</small>
            </button>
            ${choices.map(choice => `<button class="graph-outline-choice" data-outline-node="${escapeHtml(choice.id)}">◇ ${escapeHtml(choice.title)}</button>`).join('')}
          </div>`;
        }).join('')}
      </div>
    </details>`;
  }).join('');

  host.querySelectorAll('[data-outline-node]').forEach(button => {
    button.addEventListener('click', () => {
      const node = model.nodes.find(item => item.id === button.dataset.outlineNode);
      if (node) onSelect?.(node);
    });
  });
  host.querySelectorAll('.graph-outline-scene').forEach(button => {
    button.addEventListener('dblclick', () => {
      const node = model.nodes.find(item => item.id === button.dataset.outlineNode);
      if (node) onOpen?.(node);
    });
  });
}

export function renderGraphMinimap(host, svg) {
  if (!host || !svg) return;
  const clone = svg.cloneNode(true);
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.style.transform = '';
  clone.classList.add('graph-minimap-svg');
  clone.querySelectorAll('foreignObject').forEach(node => node.remove());
  clone.querySelectorAll('text').forEach(node => node.remove());
  host.replaceChildren(clone);
}

export function enableGraphNavigation(viewport, svg, {
  min = .12,
  max = 3,
  initial = .82,
  onZoom = null,
  onClear = null
} = {}) {
  let zoom = initial;
  let panX = 0;
  let panY = 0;
  let dragging = false;
  let dragPointer = null;
  let lastX = 0;
  let lastY = 0;
  let spaceDown = false;
  let pinchStart = null;
  const pointers = new Map();

  const apply = () => {
    svg.style.transformOrigin = '0 0';
    svg.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
    onZoom?.(zoom);
  };

  const setZoom = (next, cursor = null) => {
    const previous = zoom;
    zoom = Math.max(min, Math.min(max, next));

    if (cursor && previous > 0) {
      const rect = viewport.getBoundingClientRect();
      const cx = cursor.clientX - rect.left;
      const cy = cursor.clientY - rect.top;
      panX = cx - (cx - panX) * (zoom / previous);
      panY = cy - (cy - panY) * (zoom / previous);
    }
    apply();
  };

  const fit = () => {
    const width = Number(svg.getAttribute('width')) || 1;
    const height = Number(svg.getAttribute('height')) || 1;
    const pad = 34;
    zoom = Math.max(min, Math.min(max, Math.min(
      (viewport.clientWidth - pad * 2) / width,
      (viewport.clientHeight - pad * 2) / height,
      1
    )));
    panX = Math.max(pad, (viewport.clientWidth - width * zoom) / 2);
    panY = Math.max(pad, (viewport.clientHeight - height * zoom) / 2);
    apply();
  };

  const focusNode = nodeId => {
    const escaped = window.CSS?.escape ? CSS.escape(nodeId) : nodeId.replace(/"/g, '\\"');
    const node = svg.querySelector(`[data-node-id="${escaped}"]`);
    if (!node) return;
    const x = Number(node.dataset.x || 0);
    const y = Number(node.dataset.y || 0);
    const w = Number(node.dataset.w || 180);
    const h = Number(node.dataset.h || 70);
    zoom = Math.max(min, Math.min(max, Math.max(zoom, .92)));
    panX = viewport.clientWidth / 2 - (x + w / 2) * zoom;
    panY = viewport.clientHeight / 2 - (y + h / 2) * zoom;
    apply();
  };

  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    setZoom(zoom * (event.deltaY > 0 ? .9 : 1.1), event);
  }, { passive: false });

  viewport.addEventListener('pointerdown', event => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2) {
      const values = [...pointers.values()];
      pinchStart = {
        distance: Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y),
        zoom,
        center: {
          clientX: (values[0].x + values[1].x) / 2,
          clientY: (values[0].y + values[1].y) / 2
        }
      };
      return;
    }

    const canPan = event.button === 1 || (event.button === 0 && spaceDown) || event.pointerType === 'touch';
    if (!canPan) return;

    event.preventDefault();
    dragging = true;
    dragPointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    viewport.setPointerCapture?.(event.pointerId);
    viewport.classList.add('dragging');
  });

  viewport.addEventListener('pointermove', event => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2 && pinchStart) {
      const values = [...pointers.values()];
      const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
      const center = {
        clientX: (values[0].x + values[1].x) / 2,
        clientY: (values[0].y + values[1].y) / 2
      };
      setZoom(pinchStart.zoom * distance / Math.max(1, pinchStart.distance), center);
      return;
    }

    if (!dragging || dragPointer !== event.pointerId) return;
    panX += event.clientX - lastX;
    panY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    apply();
  });

  const stopPointer = event => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (dragPointer !== event.pointerId) return;
    dragging = false;
    dragPointer = null;
    viewport.classList.remove('dragging');
    try { viewport.releasePointerCapture?.(event.pointerId); } catch (_) {}
  };
  viewport.addEventListener('pointerup', stopPointer);
  viewport.addEventListener('pointercancel', stopPointer);

  viewport.addEventListener('keydown', event => {
    if (event.code === 'Space') {
      spaceDown = true;
      viewport.classList.add('space-pan');
      event.preventDefault();
    }
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      fit();
    }
    if (event.key === '0') {
      event.preventDefault();
      setZoom(1);
    }
    if (event.key === 'Escape') onClear?.();
  });

  viewport.addEventListener('keyup', event => {
    if (event.code === 'Space') {
      spaceDown = false;
      viewport.classList.remove('space-pan');
    }
  });
  viewport.addEventListener('blur', () => {
    spaceDown = false;
    viewport.classList.remove('space-pan');
  });

  apply();
  requestAnimationFrame(fit);

  return {
    zoomIn: () => setZoom(zoom * 1.15),
    zoomOut: () => setZoom(zoom / 1.15),
    reset: () => setZoom(1),
    fit,
    focusNode,
    currentZoom: () => zoom,
    destroy: () => {}
  };
}
