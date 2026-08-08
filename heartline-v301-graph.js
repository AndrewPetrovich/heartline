import { escapeHtml, sceneFrameMetrics } from './heartline-v301-domain.js';

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

const ROUTE_META = {
  common: { label: 'Общая линия', order: 0 },
  equal: { label: 'На равных', order: 1 },
  fire: { label: 'Игра с огнём', order: 2 },
  mask: { label: 'Без масок', order: 3 },
  direct: { label: 'Прямой маршрут', order: 4 }
};

export function buildGraph(content, assignments, reviews) {
  const scenes = content.scenes || [];
  const sceneIds = new Set(scenes.map(scene => scene.id));
  const nodes = [];
  const edges = [];
  const sceneIndex = new Map(scenes.map((scene, index) => [scene.id, index]));

  for (const scene of scenes) {
    const metrics = sceneFrameMetrics(content, scene.id, assignments, reviews);
    nodes.push({
      id: `scene:${scene.id}`,
      kind: 'scene',
      sceneId: scene.id,
      title: scene.title,
      chapterTitle: scene.chapterTitle || 'Другие',
      start: scene.id === content.startScene,
      end: sceneEnds(scene),
      metrics,
      routeKey: routeKey(scene.id),
      order: sceneIndex.get(scene.id)
    });

    for (const step of scene.steps || []) {
      if (step.type !== 'choice') continue;
      const choiceId = `choice:${scene.id}:${step.id}`;
      nodes.push({
        id: choiceId,
        kind: 'choice',
        sceneId: scene.id,
        choiceId: step.id,
        title: step.prompt || step.id,
        chapterTitle: scene.chapterTitle || 'Другие',
        routeKey: routeKey(scene.id),
        order: sceneIndex.get(scene.id) + 0.45
      });
      edges.push({ from: `scene:${scene.id}`, to: choiceId, kind: 'choice-enter' });
      for (const option of step.options || []) {
        const targets = resolveDynamicTargets(optionTarget(option), sceneIds);
        for (const target of targets) {
          edges.push({
            from: choiceId,
            to: `scene:${target}`,
            kind: 'option',
            label: option.label,
            optionId: option.id
          });
        }
      }
    }
  }

  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    if ((scene.steps || []).some(step => step.type === 'choice')) continue;
    const rawTargets = collectSceneGotos(scene);
    const targets = [...new Set(rawTargets.flatMap(raw => resolveDynamicTargets(raw, sceneIds)))];
    if (targets.length) {
      for (const target of targets) edges.push({ from: `scene:${scene.id}`, to: `scene:${target}`, kind: 'goto' });
    } else if (!sceneEnds(scene) && scenes[index + 1]) {
      edges.push({ from: `scene:${scene.id}`, to: `scene:${scenes[index + 1].id}`, kind: 'sequence' });
    }
  }

  return { nodes, edges };
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

function matchesNode(node, filter, searchValue, visitedSceneIds) {
  const searchMatch = !searchValue || `${node.sceneId || ''} ${node.choiceId || ''} ${node.title || ''}`.toLowerCase().includes(searchValue);
  if (!searchMatch) return false;
  if (filter === 'unread') return node.kind === 'scene' && !visitedSceneIds.has(node.sceneId);
  if (filter === 'reviews') return node.kind === 'scene' && !!node.metrics?.reviews;
  if (filter === 'missing') return node.kind === 'scene' && !!node.metrics?.missing;
  if (filter === 'endings') return !!node.end;
  return true;
}

function overviewAnchors(model, currentSceneId) {
  const { nodeById, incoming, outgoing } = graphIndex(model);
  const visible = new Set();
  const chapters = new Map();
  const firstRouteByChapter = new Set();

  for (const node of model.nodes) {
    if (!chapters.has(node.chapterTitle)) chapters.set(node.chapterTitle, []);
    chapters.get(node.chapterTitle).push(node);
    if (node.kind === 'choice' || node.start || node.end || node.sceneId === currentSceneId) visible.add(node.id);
    if (node.kind === 'scene') {
      const indegree = incoming.get(node.id)?.length || 0;
      const outdegree = outgoing.get(node.id)?.length || 0;
      if (indegree > 1 || outdegree > 1) visible.add(node.id);
    }
  }

  for (const [chapter, nodes] of chapters) {
    const scenes = nodes.filter(node => node.kind === 'scene').sort((a, b) => a.order - b.order);
    if (scenes[0]) visible.add(scenes[0].id);
    for (const scene of scenes) {
      const key = `${chapter}:${scene.routeKey}`;
      if (!firstRouteByChapter.has(key)) {
        firstRouteByChapter.add(key);
        visible.add(scene.id);
      }
    }
  }

  // Сцены, в которые непосредственно входят варианты выбора, важны для понимания ветвления.
  for (const edge of model.edges) {
    if (edge.kind === 'option') visible.add(edge.to);
  }

  // Сцены-источники Choice не дублируем, если они не являются отдельными структурными точками.
  for (const nodeId of [...visible]) if (!nodeById.has(nodeId)) visible.delete(nodeId);
  return visible;
}

function visibleNodes(model, { filter, search, visitedSceneIds, currentSceneId }) {
  const searchValue = search.trim().toLowerCase();
  if (filter === 'detail') return new Set(model.nodes.filter(node => matchesNode(node, 'all', searchValue, visitedSceneIds)).map(node => node.id));

  const visible = overviewAnchors(model, currentSceneId);
  if (filter !== 'all' || searchValue) {
    for (const node of model.nodes) {
      if (matchesNode(node, filter, searchValue, visitedSceneIds)) visible.add(node.id);
    }
  }
  return visible;
}

function compressedEdges(model, visible) {
  const { outgoing } = graphIndex(model);
  const result = [];
  const seen = new Set();

  function walk(sourceId, edge, hiddenScenes, label, visited) {
    const targetId = edge.to;
    if (visited.has(targetId)) return;
    const nextVisited = new Set(visited);
    nextVisited.add(targetId);

    if (visible.has(targetId)) {
      const key = `${sourceId}|${targetId}|${label || ''}`;
      if (!seen.has(key) && sourceId !== targetId) {
        seen.add(key);
        result.push({
          from: sourceId,
          to: targetId,
          kind: label ? 'option' : edge.kind,
          label: label || edge.label || '',
          hiddenScenes
        });
      }
      return;
    }

    const nodeHiddenCount = String(targetId).startsWith('scene:') ? hiddenScenes + 1 : hiddenScenes;
    const nextEdges = outgoing.get(targetId) || [];
    for (const nextEdge of nextEdges) {
      walk(sourceId, nextEdge, nodeHiddenCount, label || edge.label || '', nextVisited);
    }
  }

  for (const sourceId of visible) {
    for (const edge of outgoing.get(sourceId) || []) {
      walk(sourceId, edge, 0, edge.kind === 'option' ? edge.label || '' : '', new Set([sourceId]));
    }
  }
  return result;
}

function compactLayout(model, visible) {
  const visibleNodesList = model.nodes.filter(node => visible.has(node.id));
  const chapterOrder = [];
  const chapters = new Map();
  for (const node of visibleNodesList.sort((a, b) => a.order - b.order)) {
    const chapter = node.chapterTitle || 'Другие';
    if (!chapters.has(chapter)) {
      chapters.set(chapter, []);
      chapterOrder.push(chapter);
    }
    chapters.get(chapter).push(node);
  }

  const lanesPresent = new Set(visibleNodesList.map(node => node.routeKey || 'common'));
  const laneOrder = Object.keys(ROUTE_META)
    .filter(key => lanesPresent.has(key))
    .sort((a, b) => ROUTE_META[a].order - ROUTE_META[b].order);
  if (!laneOrder.includes('common')) laneOrder.unshift('common');

  const chapterWidth = 430;
  const leftGutter = 145;
  const topGutter = 86;
  const laneMeta = new Map();
  let laneTop = topGutter;

  for (const lane of laneOrder) {
    let maxCount = 1;
    for (const chapter of chapterOrder) {
      const count = (chapters.get(chapter) || []).filter(node => (node.routeKey || 'common') === lane).length;
      maxCount = Math.max(maxCount, count);
    }
    const height = Math.max(170, 86 + maxCount * 92);
    laneMeta.set(lane, { top: laneTop, height, label: ROUTE_META[lane]?.label || lane });
    laneTop += height;
  }

  const positions = new Map();
  const chapterMeta = [];
  chapterOrder.forEach((chapter, chapterIndex) => {
    const x = leftGutter + chapterIndex * chapterWidth;
    chapterMeta.push({ chapter, x, width: chapterWidth - 16 });
    for (const lane of laneOrder) {
      const list = (chapters.get(chapter) || [])
        .filter(node => (node.routeKey || 'common') === lane)
        .sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind));
      const laneInfo = laneMeta.get(lane);
      list.forEach((node, index) => {
        positions.set(node.id, {
          x: x + 24,
          y: laneInfo.top + 52 + index * 92,
          width: node.kind === 'choice' ? 338 : 318,
          height: node.kind === 'choice' ? 76 : 68
        });
      });
    }
  });

  return {
    positions,
    chapterMeta,
    laneMeta,
    laneOrder,
    width: Math.max(1250, leftGutter + chapterOrder.length * chapterWidth + 70),
    height: Math.max(720, laneTop + 54)
  };
}

export function layoutGraph(model) {
  // Геометрия вычисляется после выбора видимых структурных узлов в renderGraph.
  // Функция остаётся для обратной совместимости API.
  return { model };
}

function ensureGraphModeOption(filter) {
  const select = document.getElementById('graphFilter');
  if (!select) return;
  const overview = select.querySelector('option[value="all"]');
  if (overview) overview.textContent = 'Обзор структуры';
  if (!select.querySelector('option[value="detail"]')) {
    const option = document.createElement('option');
    option.value = 'detail';
    option.textContent = 'Все сцены (подробно)';
    select.insertBefore(option, select.children[1] || null);
  }
  select.value = filter;
}

function svgEl(svg, tag, attrs = {}) {
  const el = document.createElementNS(svg.namespaceURI, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function addBackground(svg, geometry, isDetail) {
  const bg = svgEl(svg, 'g', { class: 'graph-background' });

  geometry.chapterMeta.forEach((chapter, index) => {
    const rect = svgEl(svg, 'rect', {
      x: chapter.x - 8,
      y: 34,
      width: chapter.width,
      height: geometry.height - 74,
      rx: 18,
      class: `graph-chapter-band ${index % 2 ? 'alt' : ''}`
    });
    bg.append(rect);
    const title = svgEl(svg, 'text', { x: chapter.x + 14, y: 66, class: 'graph-chapter-title' });
    title.textContent = chapter.chapter;
    bg.append(title);
  });

  for (const lane of geometry.laneOrder) {
    const info = geometry.laneMeta.get(lane);
    if (!info) continue;
    const line = svgEl(svg, 'line', {
      x1: 128,
      x2: geometry.width - 26,
      y1: info.top + 36,
      y2: info.top + 36,
      class: `graph-lane-line route-${lane}`
    });
    bg.append(line);
    const label = svgEl(svg, 'text', { x: 20, y: info.top + 42, class: `graph-lane-title route-${lane}` });
    label.textContent = info.label;
    bg.append(label);
  }

  const note = svgEl(svg, 'text', { x: 20, y: 24, class: 'graph-overview-note' });
  note.textContent = isDetail
    ? 'Подробный режим: показаны все сцены.'
    : 'Обзор: показаны развилки, входы в главы, слияния и концовки. Поиск временно раскрывает найденную сцену.';
  bg.append(note);
  svg.append(bg);
}

function edgePath(from, to) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const dx = Math.max(58, (x2 - x1) * 0.45);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

export function renderGraph(host, model, _layout, {
  currentSceneId = null,
  visitedSceneIds = new Set(),
  filter = 'all',
  search = '',
  onSelect = null,
  onOpen = null
} = {}) {
  ensureGraphModeOption(filter);
  const searchValue = search.trim().toLowerCase();
  const visible = visibleNodes(model, { filter, search, visitedSceneIds, currentSceneId });
  const edges = compressedEdges(model, visible);
  const geometry = compactLayout(model, visible);
  const isDetail = filter === 'detail';

  const matched = new Set(model.nodes.filter(node => {
    if (!searchValue && filter === 'all') return false;
    return matchesNode(node, filter === 'detail' ? 'all' : filter, searchValue, visitedSceneIds);
  }).map(node => node.id));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
  svg.setAttribute('width', geometry.width);
  svg.setAttribute('height', geometry.height);
  svg.classList.add('story-graph-svg', 'story-map-v302');
  svg.dataset.mode = isDetail ? 'detail' : 'overview';

  const defs = svgEl(svg, 'defs');
  defs.innerHTML = `
    <marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>`;
  svg.append(defs);
  addBackground(svg, geometry, isDetail);

  const edgeLayer = svgEl(svg, 'g', { class: 'graph-edges' });
  for (const edge of edges) {
    const from = geometry.positions.get(edge.from);
    const to = geometry.positions.get(edge.to);
    if (!from || !to) continue;
    const path = svgEl(svg, 'path', {
      d: edgePath(from, to),
      class: `graph-edge ${edge.kind}${edge.label ? ' has-label' : ''}`,
      'marker-end': 'url(#graph-arrow)'
    });
    edgeLayer.append(path);

    const labelText = edge.label || (edge.hiddenScenes ? `${edge.hiddenScenes} ${edge.hiddenScenes === 1 ? 'сцена' : edge.hiddenScenes < 5 ? 'сцены' : 'сцен'}` : '');
    if (labelText) {
      const x1 = from.x + from.width;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const label = svgEl(svg, 'text', {
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2 - 7,
        class: `graph-edge-label ${edge.label ? 'option' : 'collapsed'}`
      });
      label.textContent = labelText.length > 42 ? `${labelText.slice(0, 40)}…` : labelText;
      edgeLayer.append(label);
    }
  }
  svg.append(edgeLayer);

  const nodeLayer = svgEl(svg, 'g', { class: 'graph-nodes' });
  for (const node of model.nodes) {
    if (!visible.has(node.id)) continue;
    const position = geometry.positions.get(node.id);
    if (!position) continue;

    const group = svgEl(svg, 'g', {
      transform: `translate(${position.x},${position.y})`,
      class: `graph-node ${node.kind} route-${node.routeKey || 'common'}${node.start ? ' start' : ''}${node.end ? ' end' : ''}${node.sceneId === currentSceneId ? ' current' : ''}${visitedSceneIds.has(node.sceneId) ? ' visited' : ''}${node.metrics?.reviews ? ' has-reviews' : ''}${matched.has(node.id) ? ' matched' : ''}`
    });
    group.dataset.nodeId = node.id;

    const tooltip = svgEl(svg, 'title');
    tooltip.textContent = `${node.kind === 'choice' ? 'Выбор' : node.sceneId}: ${node.title}`;
    group.append(tooltip);

    group.append(svgEl(svg, 'rect', {
      width: position.width,
      height: position.height,
      rx: node.kind === 'choice' ? 16 : 12
    }));

    const label = svgEl(svg, 'foreignObject', { width: position.width, height: position.height });
    const meta = node.kind === 'scene'
      ? `${node.metrics?.frames ?? 0} кадр.${node.metrics?.reviews ? ` · ${node.metrics.reviews} замеч.` : ''}${node.metrics?.missing ? ` · ${node.metrics.missing} без визуала` : ''}`
      : node.choiceId;
    label.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="graph-node-copy">
      <span>${escapeHtml(node.kind === 'choice' ? 'РАЗВИЛКА' : node.sceneId)}</span>
      <strong>${escapeHtml(node.title)}</strong>
      <small>${escapeHtml(meta || '')}</small>
    </div>`;
    group.append(label);

    group.addEventListener('click', () => onSelect?.(node));
    group.addEventListener('dblclick', () => { if (node.kind === 'scene') onOpen?.(node); });
    nodeLayer.append(group);
  }
  svg.append(nodeLayer);

  host.replaceChildren(svg);
  return svg;
}

export function enableGraphNavigation(viewport, svg, { min = 0.2, max = 2.4, initial = 0.75, onZoom = null } = {}) {
  let zoom = initial;
  let panX = 0;
  let panY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let spaceDown = false;

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
    const width = Number(svg.getAttribute('width')) || svg.viewBox.baseVal.width || 1;
    const height = Number(svg.getAttribute('height')) || svg.viewBox.baseVal.height || 1;
    const padding = 28;
    const next = Math.min((viewport.clientWidth - padding * 2) / width, (viewport.clientHeight - padding * 2) / height, 1);
    zoom = Math.max(min, Math.min(max, next));
    panX = Math.max(padding, (viewport.clientWidth - width * zoom) / 2);
    panY = Math.max(padding, (viewport.clientHeight - height * zoom) / 2);
    apply();
  };

  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    setZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1), event);
  }, { passive: false });

  viewport.addEventListener('pointerdown', event => {
    const shouldDrag = event.button === 1 || (event.button === 0 && spaceDown) || event.pointerType === 'touch';
    if (!shouldDrag) return;
    event.preventDefault();
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('dragging');
  });

  viewport.addEventListener('pointermove', event => {
    if (!dragging) return;
    panX += event.clientX - lastX;
    panY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    apply();
  });

  const stop = event => {
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove('dragging');
    try { viewport.releasePointerCapture(event.pointerId); } catch (_) {}
  };
  viewport.addEventListener('pointerup', stop);
  viewport.addEventListener('pointercancel', stop);

  viewport.addEventListener('keydown', event => {
    if (event.code !== 'Space') return;
    spaceDown = true;
    viewport.classList.add('space-pan');
    event.preventDefault();
  });
  viewport.addEventListener('keyup', event => {
    if (event.code !== 'Space') return;
    spaceDown = false;
    viewport.classList.remove('space-pan');
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
    fit,
    currentZoom: () => zoom,
    destroy: () => {}
  };
}
