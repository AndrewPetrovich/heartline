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

export function buildGraph(content, assignments, reviews) {
  const scenes = content.scenes || [];
  const sceneIds = new Set(scenes.map(scene => scene.id));
  const nodes = [];
  const edges = [];
  const sceneIndex = new Map(scenes.map((scene, index) => [scene.id, index]));
  const finalRouteScenes = scenes.filter(scene => scene.finalRoute);
  const lastFinalRouteIndex = finalRouteScenes.length ? Math.max(...finalRouteScenes.map(scene => sceneIndex.get(scene.id))) : -1;
  const finalRejoinScene = lastFinalRouteIndex >= 0 ? scenes.slice(lastFinalRouteIndex + 1).find(scene => !scene.finalRoute) || null : null;

  for (const scene of scenes) {
    const metrics = sceneFrameMetrics(content, scene.id, assignments, reviews);
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
        order: sceneOrder + .25 + choiceIndex * .08
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
            const finalScene = scenes.find(candidate => candidate.finalRoute === String(option.id || '').toUpperCase());
            if (finalScene) {
              edges.push({
                from: choiceNodeId,
                to: `scene:${finalScene.id}`,
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
  function walk(sourceId, edge, hiddenScenes, label, visited) {
    if (visited.has(edge.to)) return;
    const nextVisited = new Set(visited); nextVisited.add(edge.to);
    if (visible.has(edge.to)) {
      const key = `${sourceId}|${edge.to}|${label || edge.label || ''}`;
      if (!seen.has(key) && sourceId !== edge.to) {
        seen.add(key);
        result.push({ from: sourceId, to: edge.to, kind: label ? 'option' : edge.kind, label: label || edge.label || '', hiddenScenes });
      }
      return;
    }
    const count = String(edge.to).startsWith('scene:') ? hiddenScenes + 1 : hiddenScenes;
    for (const next of outgoing.get(edge.to) || []) walk(sourceId, next, count, label || edge.label || '', nextVisited);
  }
  for (const sourceId of visible) for (const edge of outgoing.get(sourceId) || []) walk(sourceId, edge, 0, edge.kind === 'option' ? edge.label || '' : '', new Set([sourceId]));
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

function makeNodeGroup(svg, node, position, { currentSceneId, visitedSceneIds, matched, dimmed = false, compact = false, onSelect, onOpen } = {}) {
  const classes = ['graph-node', node.kind, `route-${node.routeKey || 'common'}`];
  if (node.start) classes.push('start');
  if (node.end) classes.push('end');
  if (node.sceneId === currentSceneId) classes.push('current');
  if (visitedSceneIds.has(node.sceneId)) classes.push('visited');
  if (node.metrics?.reviews) classes.push('has-reviews');
  if (matched) classes.push('matched');
  if (dimmed) classes.push('dimmed');
  if (compact) classes.push('compact');
  const g = svgEl(svg, 'g', { transform: `translate(${position.x},${position.y})`, class: classes.join(' ') });
  g.dataset.nodeId = node.id;
  g.dataset.x = position.x; g.dataset.y = position.y; g.dataset.w = position.width; g.dataset.h = position.height;
  const title = svgEl(svg, 'title'); title.textContent = `${node.kind === 'choice' ? 'Выбор' : node.sceneId}: ${node.title}`; g.append(title);
  g.append(svgEl(svg, 'rect', { width: position.width, height: position.height, rx: node.kind === 'choice' ? 14 : 10 }));
  const fo = svgEl(svg, 'foreignObject', { width: position.width, height: position.height });
  const meta = node.kind === 'scene' ? `${node.metrics?.frames || 0} кадров${node.metrics?.reviews ? ` · ${node.metrics.reviews} замеч.` : ''}` : node.choiceId;
  fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="graph-node-copy"><span>${escapeHtml(node.kind === 'choice' ? 'РЕШЕНИЕ' : node.sceneId)}</span><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml(meta || '')}</small></div>`;
  g.append(fo);
  g.addEventListener('click', () => onSelect?.(node));
  g.addEventListener('dblclick', () => { if (node.kind === 'scene') onOpen?.(node); });
  return g;
}

function renderStructure(host, model, options) {
  const visible = keyStructureNodes(model, options.currentSceneId, options.filter, options.search, options.visitedSceneIds);
  const edges = compressedEdges(model, visible);
  const geo = structureGeometry(model, visible);
  const q = String(options.search || '').trim().toLowerCase();
  const matched = new Set(model.nodes.filter(node => q && nodeSearchText(node).includes(q)).map(node => node.id));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${geo.width} ${geo.height}`);
  svg.setAttribute('width', geo.width);
  svg.setAttribute('height', geo.height);
  svg.classList.add('story-graph-svg', 'graph-structure-view', 'graph-horizontal-chapters');

  const defs = svgEl(svg, 'defs');
  defs.innerHTML = '<marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>';
  svg.append(defs);

  const bg = svgEl(svg, 'g', { class: 'graph-background' });
  geo.chapterMeta.forEach((chapter, chapterIndex) => {
    bg.append(svgEl(svg, 'rect', {
      x: 12,
      y: chapter.y,
      width: chapter.width,
      height: chapter.height,
      rx: 18,
      class: `graph-chapter-band horizontal ${chapterIndex % 2 ? 'alt' : ''}`
    }));

    const title = svgEl(svg, 'text', {
      x: 28,
      y: chapter.y + 28,
      class: 'graph-chapter-title horizontal'
    });
    title.textContent = chapter.chapter;
    bg.append(title);

    chapter.routeKeys.forEach(key => {
      const laneY = chapter.laneY.get(key);
      if (laneY == null) return;
      bg.append(svgEl(svg, 'line', {
        x1: geo.left - 18,
        x2: geo.width - 42,
        y1: laneY + 31,
        y2: laneY + 31,
        class: `graph-lane-line route-${key}`
      }));
      const laneTitle = svgEl(svg, 'text', {
        x: 30,
        y: laneY + 35,
        class: `graph-lane-title route-${key}`
      });
      laneTitle.textContent = ROUTE_META[key]?.label || key;
      bg.append(laneTitle);
    });
  });
  svg.append(bg);

  const edgeLayer = svgEl(svg, 'g', { class: 'graph-edges' });
  for (const edge of edges) {
    const from = geo.positions.get(edge.from);
    const to = geo.positions.get(edge.to);
    if (!from || !to) continue;
    const isChapterTransition = from.chapter !== to.chapter;
    edgeLayer.append(svgEl(svg, 'path', {
      d: structureEdgePath(from, to, geo),
      class: `graph-edge ${edge.kind}${isChapterTransition ? ' chapter-transition' : ''}`,
      'marker-end': 'url(#graph-arrow)'
    }));
    const text = edge.label || (edge.hiddenScenes ? `${edge.hiddenScenes} сцен` : '');
    if (text && !isChapterTransition) {
      const label = svgEl(svg, 'text', {
        x: (from.x + from.width + to.x) / 2,
        y: Math.min(from.y, to.y) - 8,
        class: `graph-edge-label ${edge.label ? 'option' : 'collapsed'}`
      });
      label.textContent = text.length > 34 ? `${text.slice(0, 32)}…` : text;
      edgeLayer.append(label);
    }
  }
  svg.append(edgeLayer);

  const nodes = svgEl(svg, 'g', { class: 'graph-nodes' });
  for (const node of model.nodes) {
    if (!visible.has(node.id)) continue;
    const position = geo.positions.get(node.id);
    if (!position) continue;
    nodes.append(makeNodeGroup(svg, node, position, {
      ...options,
      matched: matched.has(node.id),
      compact: true
    }));
  }
  svg.append(nodes);

  svg.__heartlineGeometry = geo;
  host.replaceChildren(svg);
  return svg;
}

function chapterIndexMap(model) { return new Map(model.chapterOrder.map((c, i) => [c, i])); }

function renderRoutes(host, model, options) {
  const chapterIndex = chapterIndexMap(model);
  const chapterWidth = 245, left = 150, top = 118;
  const routeKeys = Object.keys(ROUTE_META).filter(key => key !== 'common' && model.nodes.some(n => n.kind === 'scene' && n.routeKey === key)).sort((a, b) => ROUTE_META[a].order - ROUTE_META[b].order);
  const yMap = new Map([['common', top], ...routeKeys.map((key, i) => [key, top + 145 + i * 122])]);
  const width = Math.max(1250, left + model.chapterOrder.length * chapterWidth + 240);
  const height = Math.max(650, top + 145 + routeKeys.length * 122 + 110);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', width); svg.setAttribute('height', height); svg.classList.add('story-graph-svg', 'graph-routes-view');

  model.chapterOrder.forEach((ch, i) => { const x = left + i * chapterWidth; svg.append(svgEl(svg, 'line', { x1: x, x2: x, y1: 56, y2: height - 36, class: 'route-chapter-guide' })); const t = svgEl(svg, 'text', { x: x + 8, y: 42, class: 'route-chapter-label' }); t.textContent = ch; svg.append(t); });
  const commonY = yMap.get('common');
  const branchCandidates = model.nodes.filter(n => n.kind === 'scene' && n.routeKey !== 'common').sort((a, b) => a.order - b.order);
  const branchChapter = branchCandidates[0]?.chapterTitle || model.chapterOrder[1] || model.chapterOrder[0];
  const branchX = left + (chapterIndex.get(branchChapter) || 1) * chapterWidth + 50;
  const endX = width - 180;

  const commonPath = svgEl(svg, 'path', { d: `M70,${commonY} C${branchX * .42},${commonY} ${branchX * .72},${commonY} ${branchX},${commonY}`, class: 'route-flow route-common' }); svg.append(commonPath);
  for (const key of routeKeys) {
    const meta = ROUTE_META[key], y = yMap.get(key);
    const path = svgEl(svg, 'path', { d: `M${branchX},${commonY} C${branchX + 90},${commonY} ${branchX + 95},${y} ${branchX + 180},${y} C${branchX + 320},${y} ${endX - 180},${y} ${endX},${y}`, class: `route-flow route-${key}` }); svg.append(path);
    const label = svgEl(svg, 'text', { x: 18, y: y + 5, class: `route-flow-label route-${key}` }); label.textContent = meta.label; svg.append(label);
  }
  const branchCircle = svgEl(svg, 'circle', { cx: branchX, cy: commonY, r: 12, class: 'route-branch-station' }); svg.append(branchCircle);

  const q = String(options.search || '').trim().toLowerCase();
  const selectedNodes = [];
  // Common line: show one scene per chapter plus structural choices.
  for (const ch of model.chapterOrder) {
    const chapterNodes = model.nodes.filter(n => n.chapterTitle === ch);
    const choices = chapterNodes.filter(n => n.kind === 'choice');
    const common = chapterNodes.filter(n => n.kind === 'scene' && n.routeKey === 'common').sort((a, b) => a.order - b.order);
    if (common[0]) selectedNodes.push(common[0]);
    if (choices[0]) selectedNodes.push(choices[0]);
    for (const key of routeKeys) {
      const routeScenes = chapterNodes.filter(n => n.kind === 'scene' && n.routeKey === key).sort((a, b) => a.order - b.order);
      if (routeScenes[0]) selectedNodes.push(routeScenes[0]);
      const ending = routeScenes.find(n => n.end); if (ending && ending !== routeScenes[0]) selectedNodes.push(ending);
    }
  }
  if (q) for (const node of model.nodes) if (nodeSearchText(node).includes(q)) selectedNodes.push(node);
  const uniq = [...new Map(selectedNodes.map(n => [n.id, n])).values()];
  const perSlot = new Map();
  for (const node of uniq) {
    const ci = chapterIndex.get(node.chapterTitle) || 0;
    const key = node.routeKey || 'common';
    const slot = `${ci}:${key}`; const offset = perSlot.get(slot) || 0; perSlot.set(slot, offset + 1);
    const yBase = yMap.get(key) ?? commonY;
    const pos = { x: left + ci * chapterWidth + 18, y: yBase - 40 + offset * 72, width: node.kind === 'choice' ? 188 : 168, height: 58 };
    const matched = (options.filter !== 'all' || q) && nodeMatches(node, options.filter, options.search, options.visitedSceneIds);
    const dimmed = (options.filter !== 'all' || q) && !matched;
    svg.append(makeNodeGroup(svg, node, pos, { ...options, matched, dimmed, compact: true }));
  }
  svg.__heartlineGeometry = { width, height };
  host.replaceChildren(svg); return svg;
}

function renderMetro(host, model, options) {
  const chapterIndex = chapterIndexMap(model);
  const routeKeys = Object.keys(ROUTE_META).filter(key => key !== 'common' && model.nodes.some(n => n.kind === 'scene' && n.routeKey === key)).sort((a, b) => ROUTE_META[a].order - ROUTE_META[b].order);
  const left = 175, chapterWidth = 220, top = 118;
  const yMap = new Map([['common', top], ...routeKeys.map((key, i) => [key, top + 120 + i * 92])]);
  const width = Math.max(1180, left + model.chapterOrder.length * chapterWidth + 240);
  const height = Math.max(580, top + 120 + routeKeys.length * 92 + 85);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', width); svg.setAttribute('height', height); svg.classList.add('story-graph-svg', 'graph-metro-view');

  const routeNodes = Object.fromEntries(['common', ...routeKeys].map(key => [key, model.nodes.filter(n => n.kind === 'scene' && n.routeKey === key).sort((a, b) => a.order - b.order)]));
  const firstRoute = routeKeys.flatMap(k => routeNodes[k]).sort((a, b) => a.order - b.order)[0];
  const branchCi = firstRoute ? (chapterIndex.get(firstRoute.chapterTitle) || 1) : 1;
  const branchX = left + branchCi * chapterWidth;
  const endX = width - 145;

  // Shared spine.
  svg.append(svgEl(svg, 'path', { d: `M70,${top} H${branchX}`, class: 'metro-line metro-common' }));
  for (const key of routeKeys) {
    const y = yMap.get(key);
    svg.append(svgEl(svg, 'path', { d: `M${branchX},${top} C${branchX + 56},${top} ${branchX + 56},${y} ${branchX + 116},${y} H${endX}`, class: `metro-line metro-${key}` }));
    const label = svgEl(svg, 'text', { x: 18, y: y + 5, class: `metro-route-label metro-${key}` }); label.textContent = ROUTE_META[key].label; svg.append(label);
  }
  svg.append(svgEl(svg, 'circle', { cx: branchX, cy: top, r: 10, class: 'metro-junction' }));

  // Chapter stations on shared line and per route. Each station summarizes all scenes in that chapter/route.
  const q = String(options.search || '').trim().toLowerCase();
  const drawStation = (key, ch, nodes, y) => {
    if (!nodes.length) return;
    const ci = chapterIndex.get(ch) || 0;
    const x = left + ci * chapterWidth;
    const active = nodes.some(n => n.sceneId === options.currentSceneId);
    const reviews = nodes.reduce((s, n) => s + (n.metrics?.reviews || 0), 0);
    const missing = nodes.reduce((s, n) => s + (n.metrics?.missing || 0), 0);
    const matched = (options.filter !== 'all' || q) && nodes.some(n => nodeMatches(n, options.filter, options.search, options.visitedSceneIds));
    const dimmed = (options.filter !== 'all' || q) && !matched;
    const g = svgEl(svg, 'g', { class: `metro-station-group route-${key}${active ? ' current' : ''}${reviews ? ' has-reviews' : ''}${matched ? ' matched' : ''}${dimmed ? ' dimmed' : ''}` });
    g.dataset.nodeId = nodes[0].id; g.dataset.x = x; g.dataset.y = y; g.dataset.w = 180; g.dataset.h = 70;
    g.append(svgEl(svg, 'circle', { cx: x, cy: y, r: active ? 10 : 7, class: 'metro-station' }));
    const maxBeads = Math.min(6, nodes.length); for (let i = 0; i < maxBeads; i++) g.append(svgEl(svg, 'circle', { cx: x + 18 + i * 12, cy: y, r: 3.2, class: 'metro-bead' }));
    const fo = svgEl(svg, 'foreignObject', { x: x - 6, y: y - 58, width: 190, height: 50 });
    fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="metro-copy"><span>${escapeHtml(ch)}</span><strong>${escapeHtml(nodes[0].title)}</strong><small>${nodes.length} сцен${missing ? ` · ${missing} без изображения` : ''}${reviews ? ` · ${reviews} замеч.` : ''}</small></div>`; g.append(fo);
    g.addEventListener('click', () => options.onSelect?.(nodes[0])); g.addEventListener('dblclick', () => options.onOpen?.(nodes[0])); svg.append(g);
  };
  for (const ch of model.chapterOrder) {
    const common = routeNodes.common.filter(n => n.chapterTitle === ch); drawStation('common', ch, common, top);
    for (const key of routeKeys) drawStation(key, ch, routeNodes[key].filter(n => n.chapterTitle === ch), yMap.get(key));
  }
  // Ending labels.
  for (const key of routeKeys) {
    const endings = routeNodes[key].filter(n => n.end); if (!endings.length) continue;
    const y = yMap.get(key); const node = endings[endings.length - 1];
    const g = svgEl(svg, 'g', { class: `metro-ending route-${key}` });
    g.append(svgEl(svg, 'circle', { cx: endX, cy: y, r: 11 }));
    const fo = svgEl(svg, 'foreignObject', { x: endX + 18, y: y - 28, width: 185, height: 58 }); fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="metro-ending-copy"><span>КОНЦОВКА</span><strong>${escapeHtml(node.title)}</strong></div>`; g.append(fo);
    g.addEventListener('click', () => options.onSelect?.(node)); g.addEventListener('dblclick', () => options.onOpen?.(node)); svg.append(g);
  }
  svg.__heartlineGeometry = { width, height };
  host.replaceChildren(svg); return svg;
}

export function layoutGraph(model) { return { model }; }

export function renderGraph(host, model, _layout, options = {}) {
  const mode = options.viewMode || 'structure';
  if (mode === 'routes') return renderRoutes(host, model, options);
  if (mode === 'metro') return renderMetro(host, model, options);
  return renderStructure(host, model, options);
}

export function renderGraphOutline(host, model, { currentSceneId = null, onSelect = null, onOpen = null } = {}) {
  const chapters = model.chapterOrder.map(chapter => ({ chapter, scenes: model.nodes.filter(n => n.kind === 'scene' && n.chapterTitle === chapter).sort((a, b) => a.order - b.order) }));
  host.innerHTML = chapters.map(({ chapter, scenes }, ci) => `<details class="graph-outline-chapter" ${ci < 3 ? 'open' : ''}><summary><span>${escapeHtml(chapter)}</span><b>${scenes.length}</b></summary><div class="graph-outline-list">${scenes.map(scene => {
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
  clone.querySelectorAll('text').forEach(n => { if (!n.classList.contains('graph-lane-title')) n.remove(); });
  host.replaceChildren(clone);
}

export function enableGraphNavigation(viewport, svg, { min = 0.18, max = 2.6, initial = 0.8, onZoom = null } = {}) {
  let zoom = initial, panX = 0, panY = 0, dragging = false, lastX = 0, lastY = 0, spaceDown = false;
  const apply = () => { svg.style.transformOrigin = '0 0'; svg.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`; onZoom?.(zoom); };
  const setZoom = (next, cursor = null) => { const prev = zoom; zoom = Math.max(min, Math.min(max, next)); if (cursor && prev > 0) { const r = viewport.getBoundingClientRect(), cx = cursor.clientX - r.left, cy = cursor.clientY - r.top; panX = cx - (cx - panX) * (zoom / prev); panY = cy - (cy - panY) * (zoom / prev); } apply(); };
  const fit = () => { const width = Number(svg.getAttribute('width')) || 1, height = Number(svg.getAttribute('height')) || 1, pad = 26; zoom = Math.max(min, Math.min(max, Math.min((viewport.clientWidth - pad * 2) / width, (viewport.clientHeight - pad * 2) / height, 1))); panX = Math.max(pad, (viewport.clientWidth - width * zoom) / 2); panY = Math.max(pad, (viewport.clientHeight - height * zoom) / 2); apply(); };
  const focusNode = nodeId => { const g = svg.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`); if (!g) return; const x = Number(g.dataset.x || 0), y = Number(g.dataset.y || 0), w = Number(g.dataset.w || 180), h = Number(g.dataset.h || 70); zoom = Math.max(min, Math.min(max, Math.max(zoom, .9))); panX = viewport.clientWidth / 2 - (x + w / 2) * zoom; panY = viewport.clientHeight / 2 - (y + h / 2) * zoom; apply(); };
  viewport.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY > 0 ? .9 : 1.1), e); }, { passive: false });
  viewport.addEventListener('pointerdown', e => { const ok = e.button === 1 || (e.button === 0 && spaceDown) || e.pointerType === 'touch'; if (!ok) return; e.preventDefault(); dragging = true; lastX = e.clientX; lastY = e.clientY; viewport.setPointerCapture(e.pointerId); viewport.classList.add('dragging'); });
  viewport.addEventListener('pointermove', e => { if (!dragging) return; panX += e.clientX - lastX; panY += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; apply(); });
  const stop = e => { if (!dragging) return; dragging = false; viewport.classList.remove('dragging'); try { viewport.releasePointerCapture(e.pointerId); } catch (_) {} };
  viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop);
  viewport.addEventListener('keydown', e => { if (e.code === 'Space') { spaceDown = true; viewport.classList.add('space-pan'); e.preventDefault(); } });
  viewport.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; viewport.classList.remove('space-pan'); } });
  viewport.addEventListener('blur', () => { spaceDown = false; viewport.classList.remove('space-pan'); });
  apply(); requestAnimationFrame(fit);
  return { zoomIn: () => setZoom(zoom * 1.15), zoomOut: () => setZoom(zoom / 1.15), fit, focusNode, currentZoom: () => zoom, destroy: () => {} };
}
