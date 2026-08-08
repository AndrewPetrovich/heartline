import { escapeHtml, sceneFrameMetrics } from './heartline-domain.js';

const ROUTE_META = {
  common: { label: 'Общая линия', order: 0, color: '#2f3130', soft: '#eef0ed' },
  equal: { label: 'На равных', order: 1, color: '#5b78d6', soft: '#eef2ff' },
  fire: { label: 'Игра с огнём', order: 2, color: '#e47a36', soft: '#fff1e8' },
  mask: { label: 'Без масок', order: 3, color: '#8a62d3', soft: '#f4efff' },
  direct: { label: 'Прямой маршрут', order: 4, color: '#299177', soft: '#eaf8f4' },
  oath: { label: 'Старая Клятва', order: 5, color: '#7c5f38', soft: '#f8f1e7' },
  network: { label: 'Новая сеть', order: 6, color: '#2f7f9c', soft: '#eaf6fa' },
  break: { label: 'Разрыв', order: 7, color: '#b25065', soft: '#fbecef' }
};

function optionTarget(option) {
  if (option.goto) return option.goto;
  if (option.fallbackGoto) return option.fallbackGoto;
  const goto = (option.steps || []).find(step => step.type === 'tech' && step.command === 'GOTO');
  return goto?.value || null;
}

function resolveDynamicTargets(raw, sceneIds) {
  const value = String(raw || '').trim().replace(/[.;]+$/, '');
  if (sceneIds.has(value)) return [value];
  if (/соответствующая маршрутная сцена/i.test(value)) {
    return ['CH03_SC03_EQUAL', 'CH03_SC03_FIRE', 'CH03_SC03_MASK'].filter(id => sceneIds.has(id));
  }
  if (/согласно ROUTE_ID/i.test(value)) {
    return ['CH06_SC04_DIRECT', 'CH06_SC05_EQUAL', 'CH06_SC05_FIRE', 'CH06_SC05_MASK'].filter(id => sceneIds.has(id));
  }
  return [];
}

function sceneEnds(scene) {
  let result = false;
  (function walk(steps) {
    for (const step of steps || []) {
      if (step.type === 'tech' && step.command === 'SYSTEM' && /^END\s+ROUTE_/i.test(String(step.value || ''))) result = true;
      if (step.type === 'choice') for (const option of step.options || []) walk(option.steps || []);
    }
  })(scene.steps || []);
  return result;
}

function collectSceneGotos(scene) {
  const out = [];
  for (const step of scene.steps || []) {
    if (step.type === 'tech' && step.command === 'GOTO') out.push(step.value);
  }
  return out;
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

function countWords(value) { return (String(value || '').trim().match(/[\p{L}\p{N}’'-]+/gu) || []).length; }
function sceneWordCount(scene) {
  let words = 0;
  (function walk(steps) {
    for (const step of steps || []) {
      if (step.type === 'choice') {
        words += countWords(step.prompt);
        for (const option of step.options || []) { words += countWords(option.label); walk(option.steps || []); }
      } else if (step.type !== 'tech') words += countWords(step.text);
    }
  })(scene?.steps || []);
  return words;
}
function choiceSignificant(step) {
  const options = step?.options || [];
  const targets = new Set(); let stateful = false;
  for (const option of options) {
    const target = optionTarget(option); if (target) targets.add(String(target));
    if (option.condition) stateful = true;
    (function walk(steps){ for(const item of steps||[]){ if(item.type==='tech' && ['SET','GOTO','IF'].includes(item.command)) stateful=true; if(item.type==='choice') for(const child of item.options||[]) walk(child.steps||[]); } })(option.steps||[]);
  }
  return stateful || targets.size > 1;
}

export function buildGraph(content, assignments, reviews) {
  const scenes = content.scenes || [];
  const sceneIds = new Set(scenes.map(scene => scene.id));
  const nodes = [];
  const edges = [];
  const sceneIndex = new Map(scenes.map((scene, index) => [scene.id, index]));
  const finalRouteScenes = scenes.filter(scene => scene.finalRoute);
  const lastFinalRouteIndex = finalRouteScenes.length ? Math.max(...finalRouteScenes.map(scene => sceneIndex.get(scene.id))) : -1;
  const finalRejoinScene = lastFinalRouteIndex >= 0 ? scenes.slice(lastFinalRouteIndex + 1).find(scene => !scene.finalRoute) || null : null;
  const metadataFinals = Array.isArray(content.storyMetadata?.finals) ? content.storyMetadata.finals : [];
  const metadataFinalMap = new Map(metadataFinals.map(item => [String(item.id).toUpperCase(), item]));

  for (const scene of scenes) {
    const metrics = { ...sceneFrameMetrics(content, scene.id, assignments, reviews), words: sceneWordCount(scene) };
    const sceneOrder = sceneIndex.get(scene.id);
    nodes.push({
      id: `scene:${scene.id}`,
      kind: 'scene',
      sceneId: scene.id,
      title: scene.title,
      chapterTitle: scene.chapterTitle || 'Другие',
      start: scene.id === content.startScene,
      end: sceneEnds(scene),
      metrics,
      routeKey: sceneRouteKey(scene),
      order: sceneOrder
    });

    const choices = (scene.steps || []).filter(step => step.type === 'choice');
    choices.forEach((step, choiceIndex) => {
      nodes.push({
        id: `choice:${scene.id}:${step.id}`,
        kind: 'choice',
        sceneId: scene.id,
        choiceId: step.id,
        title: step.prompt || step.id,
        chapterTitle: scene.chapterTitle || 'Другие',
        routeKey: sceneRouteKey(scene),
        order: sceneOrder + .25 + choiceIndex * .08,
        optionCount: (step.options || []).length,
        significant: choiceSignificant(step)
      });
    });

    if (choices.length) {
      // A scene enters its first decision. Inline decisions are then chained
      // left-to-right; explicit GOTOs still take precedence.
      edges.push({ from: `scene:${scene.id}`, to: `choice:${scene.id}:${choices[0].id}`, kind: 'choice-enter' });
      choices.forEach((step, choiceIndex) => {
        const choiceNodeId = `choice:${scene.id}:${step.id}`;
        const nextChoice = choices[choiceIndex + 1];
        const nextScene = scenes[sceneOrder + 1];
        for (const option of step.options || []) {
          const targets = resolveDynamicTargets(optionTarget(option), sceneIds);
          if (targets.length) {
            for (const target of targets) {
              edges.push({
                from: choiceNodeId,
                to: `scene:${target}`,
                kind: 'option',
                label: option.label,
                optionId: option.id
              });
            }
          } else if (step.id === 'FINAL' && ['A', 'B', 'C'].includes(String(option.id || '').toUpperCase())) {
            const finalKey = String(option.id || '').toUpperCase();
            const finalScene = scenes.find(candidate => candidate.finalRoute === finalKey);
            const finalMeta = metadataFinalMap.get(finalKey);
            if (finalScene || finalMeta) {
              edges.push({
                from: choiceNodeId,
                to: finalScene ? `scene:${finalScene.id}` : `ending:${finalKey}`,
                kind: 'option',
                label: option.label,
                optionId: option.id
              });
            }
          } else if (nextChoice) {
            edges.push({
              from: choiceNodeId,
              to: `choice:${scene.id}:${nextChoice.id}`,
              kind: 'option',
              label: option.label,
              optionId: option.id,
              reconverges: true
            });
          } else if (nextScene && !sceneEnds(scene)) {
            edges.push({
              from: choiceNodeId,
              to: `scene:${nextScene.id}`,
              kind: 'option',
              label: option.label,
              optionId: option.id,
              reconverges: true
            });
          }
        }
      });
      continue;
    }

    const rawTargets = collectSceneGotos(scene);
    const targets = [...new Set(rawTargets.flatMap(raw => resolveDynamicTargets(raw, sceneIds)))];
    if (targets.length) {
      for (const target of targets) edges.push({ from: `scene:${scene.id}`, to: `scene:${target}`, kind: 'goto' });
    } else if (!sceneEnds(scene)) {
      if (scene.finalRoute) {
        const nextSameRoute = scenes.slice(sceneOrder + 1).find(candidate => candidate.finalRoute === scene.finalRoute);
        const target = nextSameRoute || finalRejoinScene;
        if (target) edges.push({ from: `scene:${scene.id}`, to: `scene:${target.id}`, kind: 'sequence' });
      } else if (scenes[sceneOrder + 1]) {
        edges.push({ from: `scene:${scene.id}`, to: `scene:${scenes[sceneOrder + 1].id}`, kind: 'sequence' });
      }
    }
  }

  if (metadataFinals.length) {
    const finalChapter = scenes.at(-1)?.chapterTitle || 'Финалы';
    metadataFinals.forEach((item, index) => {
      const key = String(item.id || index + 1).toUpperCase();
      nodes.push({
        id: `ending:${key}`,
        kind: 'ending',
        endingId: key,
        sceneId: null,
        title: item.title || `Финал ${key}`,
        chapterTitle: finalChapter,
        start: false,
        end: true,
        metrics: { frames: 0, words: 0, reviews: 0, missing: 0, approved: 0 },
        routeKey: key === 'A' ? 'oath' : key === 'B' ? 'network' : key === 'C' ? 'break' : 'common',
        order: scenes.length + 1 + index
      });
    });
  }
  const chapterOrder = [];
  for (const scene of scenes) if (!chapterOrder.includes(scene.chapterTitle || 'Другие')) chapterOrder.push(scene.chapterTitle || 'Другие');
  return { nodes, edges, chapterOrder };
}

function graphIndex(model) {
  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  const incoming = new Map(model.nodes.map(node => [node.id, []]));
  const outgoing = new Map(model.nodes.map(node => [node.id, []]));
  for (const edge of model.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }
  return { nodeById, incoming, outgoing };
}

function svgEl(svg, tag, attrs = {}) {
  const el = document.createElementNS(svg.namespaceURI, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function nodeSearchText(node) {
  return `${node.sceneId || ''} ${node.choiceId || ''} ${node.title || ''} ${node.chapterTitle || ''}`.toLowerCase();
}

function nodeMatches(node, filter, search, visitedSceneIds) {
  const q = String(search || '').trim().toLowerCase();
  if (q && !nodeSearchText(node).includes(q)) return false;
  if (filter === 'decisions') return node.kind === 'choice';
  if (filter === 'unread') return node.kind === 'scene' && !visitedSceneIds.has(node.sceneId);
  if (filter === 'missing') return node.kind === 'scene' && !!node.metrics?.missing;
  if (filter === 'reviews') return node.kind === 'scene' && !!node.metrics?.reviews;
  if (filter === 'endings') return !!node.end;
  return true;
}

function keyStructureNodes(model, currentSceneId, filter, search, visitedSceneIds) {
  const { incoming, outgoing } = graphIndex(model);
  const visible = new Set();
  const q = String(search || '').trim().toLowerCase();
  const chapterSeen = new Set();
  const routeSeen = new Set();

  for (const node of [...model.nodes].sort((a, b) => a.order - b.order)) {
    if (node.start || node.end || node.kind === 'choice' || node.sceneId === currentSceneId) visible.add(node.id);
    if (node.kind === 'scene') {
      const indegree = incoming.get(node.id)?.length || 0;
      const outdegree = outgoing.get(node.id)?.length || 0;
      if (indegree > 1 || outdegree > 1) visible.add(node.id);
      if (!chapterSeen.has(node.chapterTitle)) {
        chapterSeen.add(node.chapterTitle);
        visible.add(node.id);
      }
      const routeMarker = `${node.chapterTitle}:${node.routeKey}`;
      if (node.routeKey !== 'common' && !routeSeen.has(routeMarker)) {
        routeSeen.add(routeMarker);
        visible.add(node.id);
      }
    }
  }

  for (const edge of model.edges) if (edge.kind === 'option') visible.add(edge.to);
  if (filter !== 'all' || q) for (const node of model.nodes) if (nodeMatches(node, filter, search, visitedSceneIds)) visible.add(node.id);
  return visible;
}

function compressedEdges(model, visible) {
  const { outgoing } = graphIndex(model);
  const result = [];
  const seen = new Set();
  function walk(sourceId, edge, hiddenScenes, label, optionId, visited) {
    if (visited.has(edge.to)) return;
    const nextVisited = new Set(visited); nextVisited.add(edge.to);
    const carriedLabel = label || (edge.kind === 'option' ? edge.label || '' : '');
    const carriedOptionId = optionId || (edge.kind === 'option' ? edge.optionId || null : null);
    if (visible.has(edge.to)) {
      const key = `${sourceId}|${edge.to}|${carriedOptionId || ''}|${carriedLabel}`;
      if (!seen.has(key) && sourceId !== edge.to) {
        seen.add(key);
        result.push({
          from: sourceId,
          to: edge.to,
          kind: carriedLabel || carriedOptionId ? 'option' : edge.kind,
          label: carriedLabel,
          optionId: carriedOptionId,
          hiddenScenes
        });
      }
      return;
    }
    const count = String(edge.to).startsWith('scene:') ? hiddenScenes + 1 : hiddenScenes;
    for (const next of outgoing.get(edge.to) || []) {
      walk(sourceId, next, count, carriedLabel, carriedOptionId, nextVisited);
    }
  }
  for (const sourceId of visible) {
    for (const edge of outgoing.get(sourceId) || []) {
      walk(
        sourceId,
        edge,
        0,
        edge.kind === 'option' ? edge.label || '' : '',
        edge.kind === 'option' ? edge.optionId || null : null,
        new Set([sourceId])
      );
    }
  }
  return result;
}

function structureGeometry(model, visible) {
  const chapters = model.chapterOrder.filter(chapter => model.nodes.some(node => visible.has(node.id) && node.chapterTitle === chapter));
  const positions = new Map();
  const chapterMeta = [];
  const left = 190;
  const nodeGap = 42;
  const sceneWidth = 214;
  const choiceWidth = 236;
  const nodeHeight = 62;
  const rowGap = 28;

  let y = 34;
  let maxWidth = 1280;

  for (const chapter of chapters) {
    const items = model.nodes
      .filter(node => visible.has(node.id) && node.chapterTitle === chapter)
      .sort((a, b) => a.order - b.order || (a.kind === 'scene' ? -1 : 1));

    const routeKeys = [...new Set(items.map(node => node.routeKey || 'common'))]
      .sort((a, b) => (ROUTE_META[a]?.order ?? 99) - (ROUTE_META[b]?.order ?? 99));
    if (!routeKeys.includes('common')) routeKeys.unshift('common');

    const laneY = new Map();
    routeKeys.forEach((key, index) => laneY.set(key, y + 68 + index * 92));

    let x = left;
    for (const node of items) {
      const width = node.kind === 'choice' ? choiceWidth : sceneWidth;
      const lane = laneY.get(node.routeKey || 'common') ?? laneY.get('common');
      positions.set(node.id, { x, y: lane, width, height: nodeHeight, chapter });
      x += width + nodeGap;
    }

    const rowHeight = 116 + Math.max(1, routeKeys.length) * 92;
    const chapterWidth = Math.max(1060, x + 70);
    maxWidth = Math.max(maxWidth, chapterWidth);
    chapterMeta.push({
      chapter,
      y,
      height: rowHeight,
      width: chapterWidth,
      routeKeys,
      laneY
    });
    y += rowHeight + rowGap;
  }

  for (const chapter of chapterMeta) chapter.width = maxWidth - 24;
  return {
    positions,
    chapterMeta,
    width: maxWidth,
    height: Math.max(680, y + 24),
    left
  };
}

function structureEdgePath(from, to, geo) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const sameChapter = from.chapter === to.chapter;

  if (sameChapter && x2 >= x1) {
    const dx = Math.max(36, (x2 - x1) * .42);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }

  if (sameChapter) {
    const lift = Math.max(34, Math.abs(y2 - y1) * .45 + 28);
    const top = Math.min(y1, y2) - lift;
    return `M${x1},${y1} C${x1 + 44},${y1} ${x1 + 54},${top} ${x1 + 96},${top} H${Math.max(x2 - 58, x1 + 96)} C${x2 - 22},${top} ${x2 - 22},${y2} ${x2},${y2}`;
  }

  // Chapter transition: leave the current horizontal row on the right,
  // descend in the margin, then enter the next chapter from the left.
  const gutter = Math.max(x1 + 64, geo.width - 48);
  const enterX = Math.max(48, x2 - 52);
  const midY = y1 + (y2 - y1) * .52;
  return `M${x1},${y1} H${gutter - 22} Q${gutter},${y1} ${gutter},${y1 + 22} V${midY - 18} Q${gutter},${midY} ${gutter - 22},${midY} H${enterX} Q${x2 - 18},${midY} ${x2 - 18},${midY + 18} V${y2} H${x2}`;
}

function makeNodeGroup(svg, node, position, { currentSceneId, visitedSceneIds, selectedNodeId = null, matched, dimmed = false, compact = false, onSelect, onOpen } = {}) {
  const classes = ['graph-node', node.kind, `route-${node.routeKey || 'common'}`];
  if (node.start) classes.push('start');
  if (node.end) classes.push('end');
  if (node.sceneId === currentSceneId) classes.push('current');
  if (visitedSceneIds?.has?.(node.sceneId)) classes.push('visited');
  if (node.id === selectedNodeId) classes.push('selected');
  if (node.metrics?.reviews) classes.push('has-reviews');
  if (matched) classes.push('matched');
  if (dimmed) classes.push('dimmed');
  if (compact) classes.push('compact');
  const g = svgEl(svg, 'g', { transform: `translate(${position.x},${position.y})`, class: classes.join(' ') });
  g.dataset.nodeId = node.id;
  g.dataset.x = position.x; g.dataset.y = position.y; g.dataset.w = position.width; g.dataset.h = position.height;
  const title = svgEl(svg, 'title'); title.textContent = `${node.kind === 'choice' ? 'Выбор' : node.kind === 'ending' ? 'Финал' : node.sceneId}: ${node.title}`; g.append(title);
  g.append(svgEl(svg, 'rect', { width: position.width, height: position.height, rx: node.kind === 'choice' ? 14 : 10 }));
  const fo = svgEl(svg, 'foreignObject', { width: position.width, height: position.height });
  const meta = node.kind === 'scene' ? `${node.metrics?.frames || 0} кадров${node.metrics?.reviews ? ` · ${node.metrics.reviews} замеч.` : ''}` : node.kind === 'ending' ? 'КОНЦОВКА' : node.choiceId;
  fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="graph-node-copy"><span>${escapeHtml(node.kind === 'choice' ? 'РЕШЕНИЕ' : node.kind === 'ending' ? 'ФИНАЛ' : node.sceneId)}</span><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml(meta || '')}</small></div>`;
  g.append(fo);
  g.addEventListener('click', () => onSelect?.(node));
  g.addEventListener('dblclick', () => { if (node.kind === 'scene' || node.kind === 'chapter') onOpen?.(node); });
  return g;
}


function graphFocusSet(model, sceneId) {
  if (!sceneId) return null;
  const startIds = model.nodes.filter(n => n.sceneId === sceneId).map(n => n.id);
  if (!startIds.length) return null;
  const { incoming, outgoing } = graphIndex(model);
  const keep = new Set(startIds);
  const walk = (map, seed) => {
    const stack = [...seed];
    while (stack.length) {
      const id = stack.pop();
      for (const edge of map.get(id) || []) {
        const next = map === outgoing ? edge.to : edge.from;
        if (!keep.has(next)) { keep.add(next); stack.push(next); }
      }
    }
  };
  walk(incoming, startIds);
  walk(outgoing, startIds);
  return keep;
}

function nodeDimmed(node, options, focusSet = null) {
  const q = String(options.search || '').trim().toLowerCase();
  const filterActive = options.filter && options.filter !== 'all';
  if (focusSet && !focusSet.has(node.id)) return true;
  if ((filterActive || q) && !nodeMatches(node, options.filter || 'all', options.search || '', options.visitedSceneIds || new Set())) return true;
  return false;
}

function edgeMetricForHidden(node) {
  if (!node || node.kind !== 'scene') return { scenes: 0, frames: 0, words: 0 };
  return { scenes: 1, frames: node.metrics?.frames || 0, words: node.metrics?.words || 0 };
}

function compressedEdgesDetailed(model, visible, allowed = null) {
  const { outgoing, nodeById } = graphIndex(model);
  const result = [];
  const seen = new Set();
  function walk(sourceId, edge, aggregate, label, visited) {
    if (visited.has(edge.to)) return;
    if (allowed && !allowed.has(edge.to) && !visible.has(edge.to)) return;
    const nextVisited = new Set(visited); nextVisited.add(edge.to);
    if (visible.has(edge.to)) {
      const key = `${sourceId}|${edge.to}|${label || edge.label || ''}`;
      if (!seen.has(key) && sourceId !== edge.to) {
        seen.add(key);
        result.push({
          from: sourceId,
          to: edge.to,
          kind: label ? 'option' : edge.kind,
          label: label || edge.label || '',
          hiddenScenes: aggregate.scenes,
          hiddenFrames: aggregate.frames,
          hiddenWords: aggregate.words
        });
      }
      return;
    }
    const metric = edgeMetricForHidden(nodeById.get(edge.to));
    const nextAggregate = {
      scenes: aggregate.scenes + metric.scenes,
      frames: aggregate.frames + metric.frames,
      words: aggregate.words + metric.words
    };
    for (const next of outgoing.get(edge.to) || []) walk(sourceId, next, nextAggregate, label || edge.label || '', nextVisited);
  }
  for (const sourceId of visible) {
    for (const edge of outgoing.get(sourceId) || []) {
      walk(sourceId, edge, { scenes: 0, frames: 0, words: 0 }, edge.kind === 'option' ? edge.label || '' : '', new Set([sourceId]));
    }
  }
  return result;
}

function addArrowDefs(svg, id = 'graph2-arrow') {
  const defs = svgEl(svg, 'defs');
  defs.innerHTML = `<marker id="${id}" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>`;
  svg.append(defs);
}

function graphSvg(width, height, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.classList.add('story-graph-svg', className);
  addArrowDefs(svg);
  return svg;
}

function layeredPositions(nodes, edges, { left = 80, top = 80, columnGap = 250, rowGap = 96, nodeWidth = 190, choiceWidth = 220, nodeHeight = 64, chapterMode = false, chapterOrder = [] } = {}) {
  const positions = new Map();
  const chapterIndex = new Map(chapterOrder.map((c, i) => [c, i]));
  const layerById = new Map();
  if (chapterMode) {
    for (const node of nodes) layerById.set(node.id, chapterIndex.get(node.chapterTitle) || 0);
  } else {
    const ordered = [...nodes].sort((a, b) => a.order - b.order);
    const uniqueOrders = [...new Set(ordered.map(n => Math.floor(n.order * 4) / 4))].sort((a,b)=>a-b);
    const orderIndex = new Map(uniqueOrders.map((v,i)=>[v,i]));
    for (const node of ordered) layerById.set(node.id, orderIndex.get(Math.floor(node.order * 4) / 4) || 0);
  }
  const layers = new Map();
  for (const node of nodes) {
    const layer = layerById.get(node.id) || 0;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push(node);
  }
  const sortedLayers = [...layers.keys()].sort((a,b)=>a-b);
  let maxRows = 1;
  for (const layer of sortedLayers) {
    const items = layers.get(layer).sort((a,b)=>a.order-b.order || a.id.localeCompare(b.id));
    maxRows = Math.max(maxRows, items.length);
    items.forEach((node, index) => {
      const width = node.kind === 'choice' ? choiceWidth : nodeWidth;
      const y = top + index * rowGap;
      positions.set(node.id, { x: left + layer * columnGap, y, width, height: nodeHeight });
    });
  }
  return {
    positions,
    width: Math.max(900, left * 2 + (Math.max(0, ...sortedLayers) + 1) * columnGap + choiceWidth),
    height: Math.max(520, top * 2 + maxRows * rowGap + nodeHeight)
  };
}

function curvePath(from, to) {
  const x1 = from.x + from.width, y1 = from.y + from.height / 2;
  const x2 = to.x, y2 = to.y + to.height / 2;
  const dx = Math.max(50, Math.abs(x2 - x1) * .42);
  if (x2 >= x1) return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  const lift = Math.min(y1, y2) - 70;
  return `M${x1},${y1} C${x1 + 60},${y1} ${x1 + 60},${lift} ${x1 + 120},${lift} H${Math.max(x2 - 80, x1 + 120)} C${x2 - 36},${lift} ${x2 - 36},${y2} ${x2},${y2}`;
}

function edgeLabelText(edge, metric = 'scenes') {
  if (edge.label) return edge.label;
  const value = metric === 'words' ? edge.hiddenWords : metric === 'frames' ? edge.hiddenFrames : edge.hiddenScenes;
  if (!value) return '';
  if (metric === 'words') return `${value.toLocaleString('ru-RU')} слов`;
  if (metric === 'frames') return `${value} кадров`;
  return `${value} сцен`;
}

function wireGraphHover(svg) {
  const nodes = [...svg.querySelectorAll('[data-node-id]')];
  const edges = [...svg.querySelectorAll('[data-edge-from][data-edge-to]')];
  const clear = () => {
    svg.classList.remove('graph-hover-mode');
    nodes.forEach(n => n.classList.remove('hover-related','hover-dim'));
    edges.forEach(e => e.classList.remove('hover-related','hover-dim'));
  };
  nodes.forEach(node => {
    node.addEventListener('mouseenter', () => {
      const id = node.dataset.nodeId;
      const related = new Set([id]);
      for (const edge of edges) if (edge.dataset.edgeFrom === id || edge.dataset.edgeTo === id) {
        related.add(edge.dataset.edgeFrom); related.add(edge.dataset.edgeTo);
      }
      svg.classList.add('graph-hover-mode');
      nodes.forEach(n => n.classList.toggle('hover-dim', !related.has(n.dataset.nodeId)));
      nodes.forEach(n => n.classList.toggle('hover-related', related.has(n.dataset.nodeId)));
      edges.forEach(e => {
        const on = e.dataset.edgeFrom === id || e.dataset.edgeTo === id;
        e.classList.toggle('hover-related', on); e.classList.toggle('hover-dim', !on);
      });
    });
    node.addEventListener('mouseleave', clear);
  });
}

function renderEdges(svg, edges, positions, { metric = 'scenes', sankey = false } = {}) {
  const layer = svgEl(svg, 'g', { class: sankey ? 'graph2-sankey-edges' : 'graph2-edges' });
  const values = edges.map(edge => metric === 'words' ? edge.hiddenWords : metric === 'frames' ? edge.hiddenFrames : edge.hiddenScenes).filter(Boolean);
  const maxValue = Math.max(1, ...values);
  for (const edge of edges) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    if (!from || !to) continue;
    const value = metric === 'words' ? edge.hiddenWords : metric === 'frames' ? edge.hiddenFrames : edge.hiddenScenes;
    const width = sankey ? 5 + Math.sqrt(Math.max(1, value || 1) / maxValue) * 25 : 1.8;
    const path = svgEl(svg, 'path', {
      d: curvePath(from, to),
      class: `graph2-edge ${edge.kind}${sankey ? ' sankey' : ''}`,
      'marker-end': sankey ? '' : 'url(#graph2-arrow)',
      'stroke-width': width,
      'data-edge-from': edge.from,
      'data-edge-to': edge.to
    });
    const title = svgEl(svg, 'title');
    title.textContent = `${edge.label || 'Переход'}${edge.hiddenScenes ? ` · скрыто сцен: ${edge.hiddenScenes}` : ''}${edge.hiddenWords ? ` · слов: ${edge.hiddenWords}` : ''}`;
    path.append(title); layer.append(path);
    const text = edgeLabelText(edge, metric);
    if (text) {
      const label = svgEl(svg, 'text', {
        x: (from.x + from.width + to.x) / 2,
        y: (from.y + to.y) / 2 + 2,
        class: `graph2-edge-label ${edge.kind}`
      });
      label.textContent = text.length > 38 ? `${text.slice(0,36)}…` : text;
      layer.append(label);
    }
  }
  svg.append(layer);
}

function chapterVisibleSet(model, chapterTitle, currentSceneId) {
  const { incoming, outgoing } = graphIndex(model);
  const chapterNodes = model.nodes.filter(n => n.chapterTitle === chapterTitle);
  const visible = new Set();
  for (const node of chapterNodes) {
    if (node.kind === 'choice' || node.sceneId === currentSceneId || node.start || node.end) visible.add(node.id);
    if (node.kind === 'scene') {
      const indegree = incoming.get(node.id)?.length || 0;
      const outdegree = outgoing.get(node.id)?.length || 0;
      if (indegree !== 1 || outdegree !== 1) visible.add(node.id);
    }
  }
  const scenes = chapterNodes.filter(n=>n.kind==='scene').sort((a,b)=>a.order-b.order);
  if (scenes[0]) visible.add(scenes[0].id);
  if (scenes.at(-1)) visible.add(scenes.at(-1).id);
  if (visible.size < 8) chapterNodes.sort((a,b)=>a.order-b.order).slice(0,16).forEach(n=>visible.add(n.id));
  if (visible.size > 22) {
    const current = chapterNodes.find(n=>n.sceneId===currentSceneId);
    const center = current?.order ?? scenes[Math.floor(scenes.length/2)]?.order ?? 0;
    const keep = [...chapterNodes].filter(n=>visible.has(n.id)).sort((a,b)=>Math.abs(a.order-center)-Math.abs(b.order-center)).slice(0,22);
    visible.clear(); keep.forEach(n=>visible.add(n.id));
  }
  return visible;
}

function renderChapterMap(host, model, options) {
  const selected = model.nodes.find(n => n.id === options.selectedNodeId) || model.nodes.find(n => n.sceneId === options.currentSceneId) || model.nodes[0];
  const chapterTitle = selected?.chapterTitle || model.chapterOrder[0] || 'Глава';
  const visible = chapterVisibleSet(model, chapterTitle, options.currentSceneId);
  const allowed = new Set(model.nodes.filter(n=>n.chapterTitle===chapterTitle).map(n=>n.id));
  const edges = compressedEdgesDetailed(model, visible, allowed);
  const nodes = model.nodes.filter(n=>visible.has(n.id));
  const geo = layeredPositions(nodes, edges, { left: 84, top: 116, columnGap: 255, rowGap: 104, nodeWidth: 190, choiceWidth: 224 });
  const svg = graphSvg(geo.width, geo.height, 'graph2-chapter-map');
  const banner = svgEl(svg,'g',{class:'graph2-chapter-banner'});
  banner.append(svgEl(svg,'rect',{x:20,y:20,width:geo.width-40,height:58,rx:14}));
  const t=svgEl(svg,'text',{x:42,y:55}); t.textContent=chapterTitle; banner.append(t); svg.append(banner);
  renderEdges(svg, edges, geo.positions, { metric: 'scenes' });
  const focusSet = options.focusSceneId ? graphFocusSet(model, options.focusSceneId) : null;
  const nodeLayer=svgEl(svg,'g',{class:'graph2-nodes'});
  for(const node of nodes){
    const pos=geo.positions.get(node.id); if(!pos)continue;
    nodeLayer.append(makeNodeGroup(svg,node,pos,{...options,selectedNodeId:options.selectedNodeId,matched:String(options.search||'').trim()&&nodeSearchText(node).includes(String(options.search).trim().toLowerCase()),dimmed:nodeDimmed(node,options,focusSet),compact:false}));
  }
  svg.append(nodeLayer); wireGraphHover(svg); host.replaceChildren(svg); return svg;
}

function decisionVisibleSet(model, { includeMerges = true } = {}) {
  const { incoming, outgoing } = graphIndex(model);
  const visible = new Set();
  for (const node of model.nodes) if (node.start || node.end) visible.add(node.id);

  const choices = model.nodes.filter(node => node.kind === 'choice').map(node => {
    const targets = new Set((outgoing.get(node.id) || []).map(edge => edge.to));
    const score = (targets.size > 1 ? 12 : 0) + (node.significant ? 4 : 0) + (node.choiceId === 'FINAL' ? 30 : 0) + (node.optionCount || 0) * .2;
    return { node, score };
  });
  // Choose at most ten strategic decisions, distributed across the whole story.
  const ordered = [...choices].sort((a,b)=>a.node.order-b.node.order);
  const bucketCount = Math.min(5, Math.max(1, model.chapterOrder.length));
  const picked = new Map();
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const from = Math.floor(bucket * ordered.length / bucketCount);
    const to = Math.floor((bucket + 1) * ordered.length / bucketCount);
    ordered.slice(from, to).sort((a,b)=>b.score-a.score || a.node.order-b.node.order).slice(0,2).forEach(item=>picked.set(item.node.id,item.node));
  }
  choices.filter(item=>item.node.choiceId==='FINAL').forEach(item=>picked.set(item.node.id,item.node));
  [...picked.values()].sort((a,b)=>a.order-b.order).slice(0,12).forEach(node=>visible.add(node.id));

  if (includeMerges) {
    const mergeScenes = model.nodes
      .filter(node => node.kind === 'scene' && !node.start && !node.end && (incoming.get(node.id)?.length || 0) > 1)
      .sort((a,b) => (incoming.get(b.id)?.length || 0) - (incoming.get(a.id)?.length || 0) || a.order - b.order)
      .slice(0, 4);
    mergeScenes.forEach(node => visible.add(node.id));
  }
  return visible;
}

function stagedPositions(nodes, { stages = 6, left = 90, top = 105, columnGap = 225, rowGap = 108, nodeWidth = 175, choiceWidth = 205, nodeHeight = 66 } = {}) {
  const sorted=[...nodes].sort((a,b)=>a.order-b.order || a.id.localeCompare(b.id));
  const positions=new Map();const buckets=Array.from({length:stages},()=>[]);
  sorted.forEach((node,index)=>{const stage=sorted.length<=1?0:Math.min(stages-1,Math.round(index/(sorted.length-1)*(stages-1)));buckets[stage].push(node);});
  let maxRows=1;
  buckets.forEach((items,stage)=>{maxRows=Math.max(maxRows,items.length);items.forEach((node,row)=>{const width=node.kind==='choice'?choiceWidth:nodeWidth;positions.set(node.id,{x:left+stage*columnGap,y:top+row*rowGap,width,height:nodeHeight});});});
  return {positions,width:left*2+stages*columnGap+choiceWidth,height:Math.max(560,top*2+maxRows*rowGap+nodeHeight),stages};
}

function renderDecisionMap(host, model, options) {
  const visible = decisionVisibleSet(model, { includeMerges: true });
  const edges = compressedEdgesDetailed(model, visible);
  const nodes = model.nodes.filter(n=>visible.has(n.id));
  const geo = stagedPositions(nodes, { stages: 6, left: 90, top: 112, columnGap: 225, rowGap: 108, nodeWidth: 176, choiceWidth: 205 });
  const height = Math.max(620, geo.height);
  const svg = graphSvg(geo.width, height, 'graph2-decision-map');
  const headers=svgEl(svg,'g',{class:'graph2-column-headers'});
  ['Начало','Ранние решения','Развитие','Перелом','Поздние решения','Финалы'].forEach((label,i)=>{const x=90+i*225;headers.append(svgEl(svg,'line',{x1:x-18,x2:x-18,y1:58,y2:height-30}));const tt=svgEl(svg,'text',{x,y:42});tt.textContent=label;headers.append(tt);});
  svg.append(headers);
  renderEdges(svg, edges, geo.positions, { metric:'scenes' });
  const focusSet=options.focusSceneId?graphFocusSet(model,options.focusSceneId):null;
  const nl=svgEl(svg,'g',{class:'graph2-nodes'});
  for(const node of nodes){ const pos=geo.positions.get(node.id); if(!pos)continue; nl.append(makeNodeGroup(svg,node,pos,{...options,dimmed:nodeDimmed(node,options,focusSet),compact:true})); }
  svg.append(nl); wireGraphHover(svg); host.replaceChildren(svg); return svg;
}

function renderRouteAnalysis(host, model, options) {
  const visible = decisionVisibleSet(model, { includeMerges: false });
  const edges = compressedEdgesDetailed(model, visible);
  const nodes = model.nodes.filter(n=>visible.has(n.id));
  const geo = stagedPositions(nodes, { stages: 6, left: 95, top: 112, columnGap: 225, rowGap: 112, nodeWidth: 172, choiceWidth: 198 });
  const height=Math.max(640,geo.height);
  const svg=graphSvg(geo.width,height,'graph2-route-analysis');
  const headers=svgEl(svg,'g',{class:'graph2-column-headers'});
  ['Старт','Ранний путь','Развитие','Перелом','Финальный путь','Финалы'].forEach((label,i)=>{const x=95+i*225;const tt=svgEl(svg,'text',{x,y:42});tt.textContent=label;headers.append(tt);});svg.append(headers);
  renderEdges(svg,edges,geo.positions,{metric:options.weightMode||'scenes',sankey:true});
  const focusSet=options.focusSceneId?graphFocusSet(model,options.focusSceneId):null;
  const nl=svgEl(svg,'g',{class:'graph2-nodes'});
  for(const node of nodes){const pos=geo.positions.get(node.id);if(!pos)continue;nl.append(makeNodeGroup(svg,node,pos,{...options,dimmed:nodeDimmed(node,options,focusSet),compact:true}));}svg.append(nl);
  wireGraphHover(svg);host.replaceChildren(svg);return svg;
}

function chapterAggregate(model, chapter) {
  const scenes=model.nodes.filter(n=>n.kind==='scene'&&n.chapterTitle===chapter);
  const choices=model.nodes.filter(n=>n.kind==='choice'&&n.chapterTitle===chapter);
  return {
    id:`chapter:${chapter}`,kind:'chapter',chapterTitle:chapter,title:chapter,sceneId:scenes[0]?.sceneId||null,
    metrics:{
      frames:scenes.reduce((s,n)=>s+(n.metrics?.frames||0),0),
      words:scenes.reduce((s,n)=>s+(n.metrics?.words||0),0),
      reviews:scenes.reduce((s,n)=>s+(n.metrics?.reviews||0),0),
      missing:scenes.reduce((s,n)=>s+(n.metrics?.missing||0),0),
      choices:choices.length,
      scenes:scenes.length
    },
    routeKey:'common',order:Math.min(...scenes.map(n=>n.order),0)
  };
}

function chapterTransitions(model) {
  const nodeById=new Map(model.nodes.map(n=>[n.id,n]));const counts=new Map();
  for(const edge of model.edges){const a=nodeById.get(edge.from),b=nodeById.get(edge.to);if(!a||!b||a.chapterTitle===b.chapterTitle)continue;const key=`${a.chapterTitle}|${b.chapterTitle}`;counts.set(key,(counts.get(key)||0)+1);}
  return [...counts.entries()].map(([key,count])=>{const [from,to]=key.split('|');return{from:`chapter:${from}`,to:`chapter:${to}`,kind:'chapter',count};});
}

function renderNovelMap(host, model, options) {
  const chapters=model.chapterOrder.map(ch=>chapterAggregate(model,ch));
  const endings=model.nodes.filter(n=>n.kind==='ending'||(n.kind==='scene'&&n.end));
  const width=1400,height=900,cx=width/2,cy=height/2,rx=430,ry=315;
  const svg=graphSvg(width,height,'graph2-novel-map');
  const positions=new Map();
  chapters.forEach((node,i)=>{const angle=-Math.PI/2+(i/Math.max(1,chapters.length))*Math.PI*2;positions.set(node.id,{x:cx+Math.cos(angle)*rx-90,y:cy+Math.sin(angle)*ry-36,width:180,height:72});});
  const chapterEdges=chapterTransitions(model);
  const edgeLayer=svgEl(svg,'g',{class:'graph2-novel-edges'});
  for(const edge of chapterEdges){const from=positions.get(edge.from),to=positions.get(edge.to);if(!from||!to)continue;const x1=from.x+from.width/2,y1=from.y+from.height/2,x2=to.x+to.width/2,y2=to.y+to.height/2;const path=svgEl(svg,'path',{d:`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`,class:'graph2-novel-edge','data-edge-from':edge.from,'data-edge-to':edge.to});const title=svgEl(svg,'title');title.textContent=`Переходов между главами: ${edge.count}`;path.append(title);edgeLayer.append(path);}svg.append(edgeLayer);
  const start=svgEl(svg,'g',{transform:`translate(${cx-95},${cy-42})`,class:'graph2-novel-center graph-node start','data-node-id':'novel:start'});start.dataset.x=cx-95;start.dataset.y=cy-42;start.dataset.w=190;start.dataset.h=84;start.append(svgEl(svg,'rect',{width:190,height:84,rx:20}));const fo=svgEl(svg,'foreignObject',{width:190,height:84});fo.innerHTML=`<div xmlns="http://www.w3.org/1999/xhtml" class="graph-node-copy"><span>НАЧАЛО ИСТОРИИ</span><strong>${escapeHtml(model.nodes.find(n=>n.start)?.title||'Старт')}</strong><small>${chapters.length} глав</small></div>`;start.append(fo);svg.append(start);
  const nl=svgEl(svg,'g',{class:'graph2-nodes'});
  for(const node of chapters){const pos=positions.get(node.id);const group=svgEl(svg,'g',{transform:`translate(${pos.x},${pos.y})`,class:`graph-node chapter${node.sceneId===options.currentSceneId?' current':''}`,'data-node-id':node.id});group.dataset.x=pos.x;group.dataset.y=pos.y;group.dataset.w=pos.width;group.dataset.h=pos.height;group.append(svgEl(svg,'rect',{width:pos.width,height:pos.height,rx:14}));const f=svgEl(svg,'foreignObject',{width:pos.width,height:pos.height});f.innerHTML=`<div xmlns="http://www.w3.org/1999/xhtml" class="graph-node-copy"><span>ГЛАВА</span><strong>${escapeHtml(node.title)}</strong><small>${node.metrics.scenes} сцен · ${node.metrics.choices} решений</small></div>`;group.append(f);group.addEventListener('click',()=>options.onSelect?.(node));group.addEventListener('dblclick',()=>options.onOpen?.(node));nl.append(group);}svg.append(nl);
  // Endings are placed on a smaller outer shelf at the lower right, keeping the radial chapter overview readable.
  const endingLayer=svgEl(svg,'g',{class:'graph2-ending-layer'});endings.slice(0,8).forEach((node,i)=>{const x=width-260,y=90+i*86;const pos={x,y,width:190,height:62};const g=makeNodeGroup(svg,node,pos,{...options,compact:true});endingLayer.append(g);});svg.append(endingLayer);
  wireGraphHover(svg);host.replaceChildren(svg);return svg;
}

export function layoutGraph(model) { return { model }; }

export function renderGraph(host, model, _layout, options = {}) {
  const mode = options.viewMode || 'chapter';
  if (mode === 'decisions') return renderDecisionMap(host, model, options);
  if (mode === 'routes') return renderRouteAnalysis(host, model, options);
  if (mode === 'novel') return renderNovelMap(host, model, options);
  return renderChapterMap(host, model, options);
}

export function renderGraphOutline(host, model, { currentSceneId = null, selectedChapter = null, onSelect = null, onOpen = null } = {}) {
  const currentNode=model.nodes.find(n=>n.kind==='scene'&&n.sceneId===currentSceneId);
  const chapterToOpen=selectedChapter||currentNode?.chapterTitle;
  const chapters = model.chapterOrder.map(chapter => ({ chapter, scenes: model.nodes.filter(n => n.kind === 'scene' && n.chapterTitle === chapter).sort((a, b) => a.order - b.order) }));
  host.innerHTML = chapters.map(({ chapter, scenes }) => `<details class="graph-outline-chapter" ${chapter===chapterToOpen?'open':''}><summary><span>${escapeHtml(chapter)}</span><b>${scenes.length}</b></summary><div class="graph-outline-list">${scenes.map(scene => {
    const choices = model.nodes.filter(n => n.kind === 'choice' && n.sceneId === scene.sceneId);
    return `<div class="graph-outline-scene-wrap"><button class="graph-outline-scene ${scene.sceneId === currentSceneId ? 'active' : ''}" data-outline-node="${escapeHtml(scene.id)}"><span>${escapeHtml(scene.title)}</span><small>${escapeHtml(scene.sceneId)}${scene.metrics?.reviews ? ` · ${scene.metrics.reviews} замеч.` : ''}</small></button>${choices.map(choice => `<button class="graph-outline-choice" data-outline-node="${escapeHtml(choice.id)}">◇ ${escapeHtml(choice.title)}</button>`).join('')}</div>`;
  }).join('')}</div></details>`).join('');
  host.querySelectorAll('[data-outline-node]').forEach(button => button.addEventListener('click', () => { const node = model.nodes.find(n => n.id === button.dataset.outlineNode); if (node) onSelect?.(node); }));
  host.querySelectorAll('.graph-outline-scene').forEach(button => button.addEventListener('dblclick', () => { const node = model.nodes.find(n => n.id === button.dataset.outlineNode); if (node) onOpen?.(node); }));
}

export function renderGraphMinimap(host, svg) {
  if (!host || !svg) return;
  const clone = svg.cloneNode(true);
  clone.removeAttribute('width'); clone.removeAttribute('height'); clone.style.transform = ''; clone.classList.add('graph-minimap-svg');
  clone.querySelectorAll('foreignObject').forEach(n => n.remove());
  clone.querySelectorAll('text').forEach(n => n.remove());
  host.replaceChildren(clone);
}

export function enableGraphNavigation(viewport, svg, { min = 0.15, max = 2.8, initial = 0.8, onZoom = null, onClear = null } = {}) {
  let zoom = initial, panX = 0, panY = 0, dragging = false, lastX = 0, lastY = 0, spaceDown = false;
  const apply = () => { svg.style.transformOrigin = '0 0'; svg.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`; onZoom?.(zoom); };
  const setZoom = (next, cursor = null) => { const prev = zoom; zoom = Math.max(min, Math.min(max, next)); if (cursor && prev > 0) { const r = viewport.getBoundingClientRect(), cx = cursor.clientX - r.left, cy = cursor.clientY - r.top; panX = cx - (cx - panX) * (zoom / prev); panY = cy - (cy - panY) * (zoom / prev); } apply(); };
  const fit = () => { const width = Number(svg.getAttribute('width')) || 1, height = Number(svg.getAttribute('height')) || 1, pad = 30; zoom = Math.max(min, Math.min(max, Math.min((viewport.clientWidth - pad * 2) / width, (viewport.clientHeight - pad * 2) / height, 1))); panX = Math.max(pad, (viewport.clientWidth - width * zoom) / 2); panY = Math.max(pad, (viewport.clientHeight - height * zoom) / 2); apply(); };
  const focusNode = nodeId => { const g = svg.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`); if (!g) return; const x = Number(g.dataset.x || 0), y = Number(g.dataset.y || 0), w = Number(g.dataset.w || 180), h = Number(g.dataset.h || 70); zoom = Math.max(min, Math.min(max, Math.max(zoom, .9))); panX = viewport.clientWidth / 2 - (x + w / 2) * zoom; panY = viewport.clientHeight / 2 - (y + h / 2) * zoom; apply(); };
  viewport.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY > 0 ? .9 : 1.1), e); }, { passive: false });
  viewport.addEventListener('pointerdown', e => { const ok = e.button === 1 || (e.button === 0 && spaceDown) || e.pointerType === 'touch'; if (!ok) return; e.preventDefault(); dragging = true; lastX = e.clientX; lastY = e.clientY; viewport.setPointerCapture(e.pointerId); viewport.classList.add('dragging'); });
  viewport.addEventListener('pointermove', e => { if (!dragging) return; panX += e.clientX - lastX; panY += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; apply(); });
  const stop = e => { if (!dragging) return; dragging = false; viewport.classList.remove('dragging'); try { viewport.releasePointerCapture(e.pointerId); } catch (_) {} };
  viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop);
  viewport.addEventListener('keydown', e => {
    if (e.code === 'Space') { spaceDown = true; viewport.classList.add('space-pan'); e.preventDefault(); }
    if (e.key.toLowerCase() === 'f') { e.preventDefault(); fit(); }
    if (e.key === '0') { e.preventDefault(); setZoom(1); }
    if (e.key === 'Escape') onClear?.();
  });
  viewport.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; viewport.classList.remove('space-pan'); } });
  viewport.addEventListener('blur', () => { spaceDown = false; viewport.classList.remove('space-pan'); });
  apply(); requestAnimationFrame(fit);
  return { zoomIn: () => setZoom(zoom * 1.15), zoomOut: () => setZoom(zoom / 1.15), reset:()=>setZoom(1), fit, focusNode, currentZoom: () => zoom, destroy: () => {} };
}
