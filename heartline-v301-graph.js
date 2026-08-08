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
  if (/соответствующая маршрутная сцена/i.test(value)) return ['CH03_SC03_EQUAL', 'CH03_SC03_FIRE', 'CH03_SC03_MASK'].filter(id => sceneIds.has(id));
  if (/согласно ROUTE_ID/i.test(value)) return ['CH06_SC04_DIRECT', 'CH06_SC05_EQUAL', 'CH06_SC05_FIRE', 'CH06_SC05_MASK'].filter(id => sceneIds.has(id));
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
  (function walk(steps, includeChoices = false) {
    for (const step of steps || []) {
      if (step.type === 'tech' && step.command === 'GOTO') out.push(step.value);
      if (includeChoices && step.type === 'choice') for (const option of step.options || []) walk(option.steps || [], true);
    }
  })(scene.steps || [], false);
  return out;
}

export function buildGraph(content, assignments, reviews) {
  const sceneIds = new Set((content.scenes || []).map(scene => scene.id));
  const nodes = [];
  const edges = [];
  const sceneIndex = new Map((content.scenes || []).map((scene, index) => [scene.id, index]));
  for (const scene of content.scenes || []) {
    const metrics = sceneFrameMetrics(content, scene.id, assignments, reviews);
    nodes.push({
      id: `scene:${scene.id}`,
      kind: 'scene',
      sceneId: scene.id,
      title: scene.title,
      chapterTitle: scene.chapterTitle,
      start: scene.id === content.startScene,
      end: sceneEnds(scene),
      metrics,
      order: sceneIndex.get(scene.id)
    });
    for (const step of scene.steps || []) {
      if (step.type !== 'choice') continue;
      const choiceId = `choice:${scene.id}:${step.id}`;
      nodes.push({ id: choiceId, kind: 'choice', sceneId: scene.id, choiceId: step.id, title: step.prompt || step.id, chapterTitle: scene.chapterTitle, order: sceneIndex.get(scene.id) + 0.45 });
      edges.push({ from: `scene:${scene.id}`, to: choiceId, kind: 'choice-enter' });
      for (const option of step.options || []) {
        const targets = resolveDynamicTargets(optionTarget(option), sceneIds);
        for (const target of targets) edges.push({ from: choiceId, to: `scene:${target}`, kind: 'option', label: option.label, optionId: option.id });
      }
    }
  }
  for (let index = 0; index < (content.scenes || []).length; index++) {
    const scene = content.scenes[index];
    if ((scene.steps || []).some(step => step.type === 'choice')) continue;
    const rawTargets = collectSceneGotos(scene);
    const targets = [...new Set(rawTargets.flatMap(raw => resolveDynamicTargets(raw, sceneIds)))];
    if (targets.length) for (const target of targets) edges.push({ from: `scene:${scene.id}`, to: `scene:${target}`, kind: 'goto' });
    else if (!sceneEnds(scene) && content.scenes[index + 1]) edges.push({ from: `scene:${scene.id}`, to: `scene:${content.scenes[index + 1].id}`, kind: 'sequence' });
  }
  return { nodes, edges };
}

export function layoutGraph(model) {
  const chapterOrder = [];
  const byChapter = new Map();
  for (const node of model.nodes) {
    const chapter = node.chapterTitle || 'Другие';
    if (!byChapter.has(chapter)) { byChapter.set(chapter, []); chapterOrder.push(chapter); }
    byChapter.get(chapter).push(node);
  }
  const positions = new Map();
  let x = 80;
  for (const chapter of chapterOrder) {
    const nodes = byChapter.get(chapter).sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind));
    let y = 90;
    for (const node of nodes) {
      positions.set(node.id, { x, y, width: node.kind === 'choice' ? 250 : 220, height: node.kind === 'choice' ? 92 : 112 });
      y += node.kind === 'choice' ? 125 : 145;
    }
    x += 310;
  }
  const width = Math.max(1200, x + 120);
  const height = Math.max(720, ...[...positions.values()].map(position => position.y + position.height + 80));
  return { positions, width, height, chapterOrder };
}

export function renderGraph(host, model, layout, { currentSceneId = null, visitedSceneIds = new Set(), filter = 'all', search = '', onSelect = null, onOpen = null } = {}) {
  const searchValue = search.trim().toLowerCase();
  const visible = new Set(model.nodes.filter(node => {
    if (filter === 'unread' && node.kind === 'scene' && visitedSceneIds.has(node.sceneId)) return false;
    if (filter === 'reviews' && node.kind === 'scene' && !node.metrics?.reviews) return false;
    if (filter === 'missing' && node.kind === 'scene' && !node.metrics?.missing) return false;
    if (filter === 'endings' && !node.end) return false;
    if (searchValue && !`${node.sceneId || ''} ${node.choiceId || ''} ${node.title}`.toLowerCase().includes(searchValue)) return false;
    return true;
  }).map(node => node.id));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute('width', layout.width);
  svg.setAttribute('height', layout.height);
  svg.classList.add('story-graph-svg');
  const defs = document.createElementNS(svg.namespaceURI, 'defs');
  defs.innerHTML = '<marker id="graph-arrow" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#9aa0a6"/></marker>';
  svg.append(defs);
  for (const edge of model.edges) {
    if (!visible.has(edge.from) || !visible.has(edge.to)) continue;
    const from = layout.positions.get(edge.from);
    const to = layout.positions.get(edge.to);
    if (!from || !to) continue;
    const path = document.createElementNS(svg.namespaceURI, 'path');
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const middle = (x1 + x2) / 2;
    path.setAttribute('d', `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`);
    path.setAttribute('class', `graph-edge ${edge.kind}`);
    path.setAttribute('marker-end', 'url(#graph-arrow)');
    svg.append(path);
  }
  for (const node of model.nodes) {
    if (!visible.has(node.id)) continue;
    const position = layout.positions.get(node.id);
    if (!position) continue;
    const group = document.createElementNS(svg.namespaceURI, 'g');
    group.setAttribute('transform', `translate(${position.x},${position.y})`);
    group.setAttribute('class', `graph-node ${node.kind}${node.start ? ' start' : ''}${node.end ? ' end' : ''}${node.sceneId === currentSceneId ? ' current' : ''}${visitedSceneIds.has(node.sceneId) ? ' visited' : ''}${node.metrics?.reviews ? ' has-reviews' : ''}`);
    group.dataset.nodeId = node.id;
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    rect.setAttribute('width', position.width);
    rect.setAttribute('height', position.height);
    rect.setAttribute('rx', node.kind === 'choice' ? 22 : 14);
    group.append(rect);
    const label = document.createElementNS(svg.namespaceURI, 'foreignObject');
    label.setAttribute('width', position.width);
    label.setAttribute('height', position.height);
    label.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="graph-node-copy"><span>${escapeHtml(node.kind === 'choice' ? 'ВЫБОР' : node.sceneId)}</span><strong>${escapeHtml(node.title)}</strong>${node.kind === 'scene' ? `<small>${node.metrics.missing ? `нет изображений: ${node.metrics.missing}` : `визуалы: ${node.metrics.approved}/${node.metrics.frames}`}${node.metrics.reviews ? ` · замечаний: ${node.metrics.reviews}` : ''}</small>` : ''}</div>`;
    group.append(label);
    group.addEventListener('click', () => onSelect?.(node));
    group.addEventListener('dblclick', () => { if (node.kind === 'scene') onOpen?.(node); });
    svg.append(group);
  }
  host.replaceChildren(svg);
  return svg;
}

export function enableGraphNavigation(viewport, svg, { min = 0.25, max = 2.4, initial = 0.75, onZoom = null } = {}) {
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
    if (cursor) {
      const rect = viewport.getBoundingClientRect();
      const cx = cursor.clientX - rect.left;
      const cy = cursor.clientY - rect.top;
      panX = cx - (cx - panX) * (zoom / previous);
      panY = cy - (cy - panY) * (zoom / previous);
    }
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
  const keydown = event => { if (event.code === 'Space') { spaceDown = true; viewport.classList.add('space-pan'); event.preventDefault(); } };
  const keyup = event => { if (event.code === 'Space') { spaceDown = false; viewport.classList.remove('space-pan'); } };
  viewport.addEventListener('keydown', keydown);
  viewport.addEventListener('keyup', keyup);
  apply();
  return {
    zoomIn: () => setZoom(zoom * 1.15),
    zoomOut: () => setZoom(zoom / 1.15),
    fit: () => { zoom = Math.min(viewport.clientWidth / svg.width.baseVal.value, viewport.clientHeight / svg.height.baseVal.value, 1); panX = 16; panY = 16; apply(); },
    currentZoom: () => zoom,
    destroy: () => {}
  };
}
