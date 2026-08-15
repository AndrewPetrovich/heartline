import { escapeHtml } from './heartline-domain.js';
import { findOrthogonalRoute } from './heartline-graph-layout.js';

function number(value) { return Number(value || 0).toLocaleString('ru-RU'); }
function svgEl(svg, tag, attrs = {}) {
  const element = document.createElementNS(svg.namespaceURI, tag);
  Object.entries(attrs).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') element.setAttribute(key, String(value)); });
  return element;
}

function createSvg(layout, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute('width', layout.width);
  svg.setAttribute('height', layout.height);
  svg.classList.add('story-graph-svg', className);
  const defs = svgEl(svg, 'defs');
  defs.innerHTML = `
    <marker id="sg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L8,3 z" fill="#735fda"></path></marker>
    <filter id="sg-soft-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#171816" flood-opacity=".07"/></filter>`;
  svg.append(defs);
  return svg;
}

function labelForNode(node) {
  if (node.kind === 'start') return 'НАЧАЛО';
  if (node.kind === 'logicalDecision') return `РЕШЕНИЕ ${node.choiceId || ''}`.trim();
  if (node.kind === 'decisionOccurrence') return `CHOICE ${node.choiceId || ''}`.trim();
  if (node.kind === 'storyBeat') return node.intersection ? 'ПЕРЕСЕЧЕНИЕ ЛИНИЙ' : 'СЮЖЕТНЫЙ БЛОК';
  if (node.kind === 'merge') return 'СЛИЯНИЕ';
  if (node.kind === 'ending' || node.kind === 'routeFinal') return 'ФИНАЛ';
  if (node.kind === 'structuralBlock') return 'СТРУКТУРНЫЙ БЛОК';
  if (node.kind === 'scene') return node.code || node.sceneId || 'СЦЕНА';
  return node.kind || 'УЗЕЛ';
}

function nodeMeta(node) {
  if (node.kind === 'logicalDecision') return `${node.optionCount || 0} вариантов${node.occurrenceCount > 1 ? ` · ${node.occurrenceCount} появления` : ''}`;
  if (node.kind === 'storyBeat') return `${node.metrics?.scenes || 0} сцен · ${number(node.metrics?.words || 0)} слов`;
  if (node.kind === 'merge') return `${node.fanIn || 2} входящих путей`;
  if (node.kind === 'ending' || node.kind === 'routeFinal') return 'Концовка новеллы';
  if (node.kind === 'scene') return `${node.metrics?.frames || 0} кадров${node.metrics?.reviews ? ` · ${node.metrics.reviews} замеч.` : ''}`;
  return `${node.metrics?.scenes || 0} сцен`;
}

function createCardNode(svg, node, position, options = {}) {
  if (node.kind === 'merge') return createMergeNode(svg, node, position, options);
  if (node.kind === 'structuralBlock') return createStructuralBlock(svg, node, position, options);
  const classes = ['story-graph-node', `kind-${node.kind}`];
  if (node.start || node.kind === 'start') classes.push('is-start');
  if (node.end || node.kind === 'ending' || node.kind === 'routeFinal') classes.push('is-ending');
  if (node.id === options.selectedNodeId) classes.push('is-selected');
  if (node.sceneId === options.currentSceneId) classes.push('is-current');
  if (options.matched) classes.push('is-matched');
  if (options.dimmed) classes.push('is-dimmed');
  if (node.metrics?.reviews) classes.push('has-reviews');
  const group = svgEl(svg, 'g', { transform: `translate(${position.x},${position.y})`, class: classes.join(' '), role: 'button', tabindex: '0' });
  group.dataset.nodeId = node.id; group.dataset.x = position.x; group.dataset.y = position.y; group.dataset.w = position.width; group.dataset.h = position.height;
  group.append(svgEl(svg, 'rect', { width: position.width, height: position.height, rx: 12, filter: 'url(#sg-soft-shadow)' }));
  const title = svgEl(svg, 'title'); title.textContent = `${labelForNode(node)}: ${node.title || ''}`; group.append(title);
  const badges = [];
  if (node.repeated) badges.push('<i title="Повторяющееся логическое решение">×</i>');
  if (node.metrics?.reviews) badges.push(`<i title="Замечаний: ${node.metrics.reviews}">●</i>`);
  if (node.metrics?.missing) badges.push(`<i title="Без изображений: ${node.metrics.missing}">○</i>`);
  const fo = svgEl(svg, 'foreignObject', { width: position.width, height: position.height });
  fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="story-graph-node-copy">
    <div class="story-graph-node-kicker"><span>${escapeHtml(labelForNode(node))}</span><b>${badges.join('')}</b></div>
    <strong>${escapeHtml(node.title || labelForNode(node))}</strong>
    <small>${escapeHtml(nodeMeta(node))}</small>
  </div>`;
  group.append(fo);
  group.addEventListener('click', event => { event.stopPropagation(); options.onSelect?.(node); });
  group.addEventListener('dblclick', event => { event.stopPropagation(); options.onOpen?.(node); });
  group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); options.onSelect?.(node); } });
  return group;
}

function createMergeNode(svg, node, position, options = {}) {
  const group = svgEl(svg, 'g', { transform: `translate(${position.x},${position.y})`, class: `story-graph-node kind-merge${node.id === options.selectedNodeId ? ' is-selected' : ''}`, role: 'button' });
  group.dataset.nodeId = node.id; group.dataset.x = position.x; group.dataset.y = position.y; group.dataset.w = position.width; group.dataset.h = position.height;
  group.append(svgEl(svg, 'circle', { cx: position.width / 2, cy: position.height / 2, r: Math.min(position.width, position.height) / 2 - 2 }));
  const text = svgEl(svg, 'text', { x: position.width / 2, y: position.height / 2 + 3, 'text-anchor': 'middle' }); text.textContent = node.fanIn || '•'; group.append(text);
  const title = svgEl(svg, 'title'); title.textContent = `Слияние: ${node.fanIn || 2} входящих путей`; group.append(title);
  group.addEventListener('click', event => { event.stopPropagation(); options.onSelect?.(node); });
  return group;
}

function sparklineSvg(values = []) {
  const width = 175, height = 30, gap = 3;
  const barWidth = Math.max(3, (width - gap * Math.max(0, values.length - 1)) / Math.max(1, values.length));
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${values.map((value, index) => { const h = Math.max(2, Math.round(value * (height - 3))); return `<rect x="${index * (barWidth + gap)}" y="${height - h}" width="${barWidth}" height="${h}" rx="1.5"></rect>`; }).join('')}</svg>`;
}

function createStructuralBlock(svg, node, position, options = {}) {
  const classes = ['story-graph-node', 'kind-structuralBlock'];
  if (node.id === options.selectedNodeId) classes.push('is-selected');
  const group = svgEl(svg, 'g', { transform: `translate(${position.x},${position.y})`, class: classes.join(' '), role: 'button' });
  group.dataset.nodeId = node.id; group.dataset.x = position.x; group.dataset.y = position.y; group.dataset.w = position.width; group.dataset.h = position.height;
  group.append(svgEl(svg, 'rect', { width: position.width, height: position.height, rx: 16, filter: 'url(#sg-soft-shadow)' }));
  const fo = svgEl(svg, 'foreignObject', { width: position.width, height: position.height });
  fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="novel-block-copy">
    <div class="novel-block-icon">✦</div>
    <div class="novel-block-main"><span>СТРУКТУРНЫЙ БЛОК</span><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml((node.keyPoints || []).join(' · '))}</small></div>
    <div class="novel-block-range"><b>1</b><i></i><b>${number(node.metrics?.scenes || 0)}</b></div>
    <div class="novel-block-density"><span>${number(node.metrics?.scenes || 0)} сцен</span>${sparklineSvg(node.density || [])}</div>
    <div class="novel-block-badges"><em>${node.metrics?.choices || 0} выборов</em><em>${node.metrics?.branches || 0} ветвлений</em></div>
  </div>`;
  group.append(fo);
  group.addEventListener('click', event => { event.stopPropagation(); options.onSelect?.(node); });
  group.addEventListener('dblclick', event => { event.stopPropagation(); options.onOpen?.(node); });
  return group;
}

function lineClass(edge) {
  if (edge.kind === 'consequence' || edge.kind === 'conditional-flow') return 'is-conditional';
  if (edge.kind === 'option' || edge.kind === 'route') return 'is-option';
  if (edge.kind === 'rejoin') return 'is-rejoin';
  if (edge.kind === 'return') return 'is-return';
  if (edge.kind === 'technical') return 'is-technical';
  if (edge.kind === 'ending') return 'is-ending';
  return 'is-sequence';
}

function segmentHitsRect(segment, rect, margin = 8) {
  const [x1, y1, x2, y2] = segment;
  const left = rect.x - margin, right = rect.x + rect.width + margin, top = rect.y - margin, bottom = rect.y + rect.height + margin;
  if (Math.abs(y1 - y2) < .1) return y1 >= top && y1 <= bottom && Math.max(x1, x2) >= left && Math.min(x1, x2) <= right;
  if (Math.abs(x1 - x2) < .1) return x1 >= left && x1 <= right && Math.max(y1, y2) >= top && Math.min(y1, y2) <= bottom;
  return false;
}

function fallbackOrthogonalRoute(from, to, positions, offset = 0) {
  const x1 = from.x + from.width, y1 = from.y + from.height / 2 + offset, x2 = to.x, y2 = to.y + to.height / 2 + offset;
  const obstacles = [...positions.values()].filter(rect => rect !== from && rect !== to);
  const base = x2 >= x1 ? x1 + (x2 - x1) / 2 : Math.max(x1, x2) + 72;
  const candidates = [base, base + 32, base - 32, base + 66, base - 66, Math.max(x1, x2) + 115, Math.min(x1, x2) - 75];
  for (const mid of candidates) {
    const segments = [[x1, y1, mid, y1], [mid, y1, mid, y2], [mid, y2, x2, y2]];
    if (!obstacles.some(rect => segments.some(segment => segmentHitsRect(segment, rect)))) return { segments, mid };
  }
  const rects = [...positions.values()];
  const minY = Math.min(...rects.map(rect => rect.y));
  const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
  const xOut = x1 + 24, xIn = x2 - 24;
  for (const gutter of [minY - 45, maxY + 45, minY - 80, maxY + 80]) {
    const segments = [[x1,y1,xOut,y1],[xOut,y1,xOut,gutter],[xOut,gutter,xIn,gutter],[xIn,gutter,xIn,y2],[xIn,y2,x2,y2]];
    if (!obstacles.some(rect => segments.some(segment => segmentHitsRect(segment, rect)))) return { segments, mid: (xOut + xIn) / 2, gutter };
  }
  const gutter = minY - 110;
  return { segments: [[x1,y1,xOut,y1],[xOut,y1,xOut,gutter],[xOut,gutter,xIn,gutter],[xIn,gutter,xIn,y2],[xIn,y2,x2,y2]], mid: (xOut + xIn) / 2, gutter };
}

function roundedPath(segments, radius = 10) {
  if (!segments?.length) return '';
  if (segments.length !== 3) {
    const points = [[segments[0][0], segments[0][1]], ...segments.map(segment => [segment[2], segment[3]])];
    return points.map((point, index) => `${index ? 'L' : 'M'}${point[0]},${point[1]}`).join(' ');
  }
  const [a, b, c] = segments; const [x1, y1, xm] = a; const [, , , y2] = b; const [, , x2] = c;
  if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} H${x2}`;
  const dx1 = Math.sign(xm - x1) || 1, dy = Math.sign(y2 - y1) || 1, dx2 = Math.sign(x2 - xm) || 1;
  const r1 = Math.min(radius, Math.abs(xm - x1) / 2, Math.abs(y2 - y1) / 2); const r2 = Math.min(radius, Math.abs(x2 - xm) / 2, Math.abs(y2 - y1) / 2);
  return `M${x1},${y1} H${xm - dx1 * r1} Q${xm},${y1} ${xm},${y1 + dy * r1} V${y2 - dy * r2} Q${xm},${y2} ${xm + dx2 * r2},${y2} H${x2}`;
}

function edgeMetricValue(edge, mode = 'scenes') {
  if (edge.routeCount) return edge.routeCount;
  if (mode === 'words') return edge.hiddenWords || 1;
  if (mode === 'frames') return edge.hiddenFrames || 1;
  return edge.hiddenScenes || edge.count || 1;
}
function edgeText(edge, mode = 'scenes') {
  if (edge.label) return edge.label;
  const value = mode === 'words' ? edge.hiddenWords : mode === 'frames' ? edge.hiddenFrames : edge.hiddenScenes;
  if (!value) return '';
  return mode === 'words' ? `${number(value)} слов` : mode === 'frames' ? `${number(value)} кадров` : `${number(value)} сцен`;
}
function shouldShowLabel(edge, presentation, options) {
  if (options.showLabels === false) return false;
  if (edge.hiddenScenes || edge.hiddenFrames || edge.hiddenWords || edge.collapsedParallel) return true;
  const source = presentation.nodes.find(node => node.id === edge.from);
  if (source?.kind === 'logicalDecision') {
    const targets = new Set(presentation.edges.filter(item => item.from === edge.from).map(item => item.to));
    return targets.size > 1 && Boolean(edge.label);
  }
  return false;
}

function boxesOverlap(a, b, margin = 2) {
  return a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
}

function labelBox(text, x, y) {
  return { x: x - Math.min(230, Math.max(32, String(text).length * 4.7 + 10)) / 2, y: y - 10, width: Math.min(230, Math.max(32, String(text).length * 4.7 + 10)), height: 14 };
}

function labelCanBePlaced(box, layout, placed) {
  if ([...layout.positions.values()].some(rect => boxesOverlap(box, rect, 5))) return false;
  return !placed.some(other => boxesOverlap(box, other, 4));
}

function renderOrthogonalEdges(svg, presentation, layout, options = {}) {
  const layer = svgEl(svg, 'g', { class: 'story-graph-edges' });
  const placedLabels = [];
  const pairCounts = new Map(); presentation.edges.forEach(edge => { const key = `${edge.from}|${edge.to}`; pairCounts.set(key, (pairCounts.get(key) || 0) + 1); });
  const cursor = new Map();
  presentation.edges.forEach(edge => {
    const from = layout.positions.get(edge.from), to = layout.positions.get(edge.to); if (!from || !to) return;
    const key = `${edge.from}|${edge.to}`, index = cursor.get(key) || 0; cursor.set(key, index + 1);
    const total = pairCounts.get(key) || 1, offset = total > 1 ? (index - (total - 1) / 2) * 12 : 0;
    const route = findOrthogonalRoute(edge.from, edge.to, layout.positions, offset) || fallbackOrthogonalRoute(from, to, layout.positions, offset);
    const backwards = to.x + to.width / 2 < from.x + from.width / 2;
    const edgeClass = backwards && !['ending','return'].includes(edge.kind) ? 'is-return' : lineClass(edge);
    const marker = edge.kind === 'rejoin' || backwards ? null : 'url(#sg-arrow)';
    const path = svgEl(svg, 'path', { d: roundedPath(route.segments), class: `story-graph-edge ${edgeClass}`, 'marker-end': marker, 'data-edge-from': edge.from, 'data-edge-to': edge.to });
    const title = svgEl(svg, 'title'); title.textContent = `${edge.label || 'Переход'}${edge.hiddenScenes ? ` · ${edge.hiddenScenes} сцен` : ''}${edge.hiddenWords ? ` · ${number(edge.hiddenWords)} слов` : ''}`; path.append(title); layer.append(path);
    const text = edgeText(edge, options.weightMode || 'scenes');
    if (text && shouldShowLabel(edge, presentation, options)) {
      const labelText = text.length > 40 ? `${text.slice(0, 38)}…` : text;
      const labelX = route.mid;
      const labelY = route.gutter != null ? route.gutter - 7 : (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 7 + offset;
      const box = labelBox(labelText, labelX, labelY);
      if (labelCanBePlaced(box, layout, placedLabels)) {
        placedLabels.push(box);
        const label = svgEl(svg, 'text', { x: labelX, y: labelY, class: `story-graph-edge-label ${edgeClass}` });
        label.textContent = labelText; layer.append(label);
      }
    }
  });
  svg.append(layer);
}

function renderSankeyEdges(svg, presentation, layout, options = {}) {
  const layer = svgEl(svg, 'g', { class: 'story-graph-sankey' });
  const placedLabels = [];
  const values = presentation.edges.map(edge => edgeMetricValue(edge, options.weightMode)); const max = Math.max(1, ...values);
  presentation.edges.forEach((edge, index) => {
    const from = layout.positions.get(edge.from), to = layout.positions.get(edge.to); if (!from || !to) return;
    const x1 = from.x + from.width, y1 = from.y + from.height / 2, x2 = to.x, y2 = to.y + to.height / 2, dx = Math.max(55, (x2 - x1) * .45);
    const width = 6 + Math.sqrt((values[index] || 1) / max) * 34;
    const path = svgEl(svg, 'path', { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, class: `story-graph-flow ${lineClass(edge)}`, 'stroke-width': width, 'data-edge-from': edge.from, 'data-edge-to': edge.to });
    const title = svgEl(svg, 'title'); title.textContent = `${edge.label || 'Поток'} · ${edgeMetricValue(edge, options.weightMode)} ${options.weightMode === 'words' ? 'слов' : options.weightMode === 'frames' ? 'кадров' : edge.routeCount ? 'маршрутов' : 'сцен'}`; path.append(title); layer.append(path);
    const text = edgeText(edge, options.weightMode) || (edge.routeCount ? `${edge.routeCount} маршрутов` : '');
    const show = options.showLabels ?? presentation.metadata?.showEdgeLabels ?? false;
    if (text && show) {
      const labelX = (x1 + x2) / 2;
      const labelY = (y1 + y2) / 2 - width / 2 - 5;
      const box = labelBox(text, labelX, labelY);
      if (labelCanBePlaced(box, layout, placedLabels)) {
        placedLabels.push(box);
        const label = svgEl(svg, 'text', { x: labelX, y: labelY, class: 'story-graph-flow-label' });
        label.textContent = text; layer.append(label);
      }
    }
  });
  svg.append(layer);
}

function renderStoryBackground(svg, presentation, layout) {
  const layer = svgEl(svg, 'g', { class: 'story-map-background' });
  const bands = layout.bands || { left: 110, top: 100, laneGap: 142, groups: [] };
  (bands.groups || []).forEach(group => {
    const title = svgEl(svg, 'text', { x: group.x, y: 38, class: 'story-map-group-title' }); title.textContent = group.title || group.id; layer.append(title);
    layer.append(svgEl(svg, 'line', { x1: group.x - 14, x2: group.x - 14, y1: 52, y2: layout.height - 35, class: 'story-map-group-guide' }));
  });
  (presentation.lanes || []).forEach((lane, index) => {
    const y = bands.top + index * bands.laneGap + 37;
    layer.append(svgEl(svg, 'line', { x1: 55, x2: layout.width - 45, y1: y, y2: y, class: 'story-map-lane' }));
    const label = svgEl(svg, 'text', { x: 25, y: y + 4, class: 'story-map-lane-title' }); label.textContent = lane.title || lane.id; layer.append(label);
  });
  svg.append(layer);
}

function renderColumnHeaders(svg, presentation, layout) {
  if (!presentation.columns?.length) return;
  const stageX = new Map(); for (const position of layout.positions.values()) if (position.stage !== undefined && !stageX.has(position.stage)) stageX.set(position.stage, position.x);
  const layer = svgEl(svg, 'g', { class: 'story-graph-columns' });
  presentation.columns.forEach((label, index) => { const x = stageX.get(index) ?? 105 + index * 238; layer.append(svgEl(svg, 'line', { x1: x - 24, x2: x - 24, y1: 58, y2: layout.height - 28 })); const text = svgEl(svg, 'text', { x, y: 39 }); text.textContent = label; layer.append(text); });
  svg.append(layer);
}

function renderNovelConnections(svg, presentation, layout) {
  const layer = svgEl(svg, 'g', { class: 'novel-map-connections' });
  presentation.edges.forEach(edge => { const from = layout.positions.get(edge.from), to = layout.positions.get(edge.to); if (!from || !to) return; const x = from.x + 55, y1 = from.y + from.height, y2 = to.y; layer.append(svgEl(svg, 'path', { d: `M${x},${y1} V${y2}`, class: 'novel-map-connector', 'data-edge-from': edge.from, 'data-edge-to': edge.to })); layer.append(svgEl(svg, 'circle', { cx: x, cy: (y1 + y2) / 2, r: 4, class: 'novel-map-station' })); });
  svg.append(layer);
}

function wireHover(svg) {
  const nodes = [...svg.querySelectorAll('[data-node-id]')], edges = [...svg.querySelectorAll('[data-edge-from][data-edge-to]')];
  const clear = () => { svg.classList.remove('has-hover-focus'); nodes.forEach(node => node.classList.remove('is-related', 'is-hover-dimmed')); edges.forEach(edge => edge.classList.remove('is-related', 'is-hover-dimmed')); };
  nodes.forEach(node => {
    node.addEventListener('mouseenter', () => { const id = node.dataset.nodeId, related = new Set([id]); edges.forEach(edge => { if (edge.dataset.edgeFrom === id || edge.dataset.edgeTo === id) { related.add(edge.dataset.edgeFrom); related.add(edge.dataset.edgeTo); } }); svg.classList.add('has-hover-focus'); nodes.forEach(item => { const active = related.has(item.dataset.nodeId); item.classList.toggle('is-related', active); item.classList.toggle('is-hover-dimmed', !active); }); edges.forEach(edge => { const active = edge.dataset.edgeFrom === id || edge.dataset.edgeTo === id; edge.classList.toggle('is-related', active); edge.classList.toggle('is-hover-dimmed', !active); }); });
    node.addEventListener('mouseleave', clear);
  });
}

function nodeInHighlightSet(node, highlight) {
  if (!highlight) return true;
  if (highlight.has(node.id)) return true;
  if (node.sceneId && highlight.has(`scene:${node.sceneId}`)) return true;
  if ((node.sourceSceneIds || []).some(sceneId => highlight.has(`scene:${sceneId}`))) return true;
  if ((node.occurrences || []).some(occurrence => highlight.has(occurrence.id || occurrence.occurrenceId))) return true;
  if (node.choiceId && highlight.has(`decision:${node.choiceId}`)) return true;
  if (node.endingId && highlight.has(`ending:${node.endingId}`)) return true;
  return false;
}

export function renderGraphPresentation(host, model, bundle, options = {}) {
  const { presentation, layout } = bundle;
  const className = presentation.viewType === 'story' ? 'storyline-map-svg' : presentation.viewType === 'decisions' ? 'decision-map-svg' : presentation.viewType === 'routes' ? 'route-analysis-svg' : 'novel-map-svg';
  const svg = createSvg(layout, className);
  if (presentation.viewType === 'story') renderStoryBackground(svg, presentation, layout);
  if (presentation.viewType === 'decisions' || presentation.viewType === 'routes') renderColumnHeaders(svg, presentation, layout);
  if (presentation.viewType === 'novel') renderNovelConnections(svg, presentation, layout);
  else if (presentation.viewType === 'routes') renderSankeyEdges(svg, presentation, layout, options);
  else renderOrthogonalEdges(svg, presentation, layout, options);

  const layer = svgEl(svg, 'g', { class: 'story-graph-nodes' });
  const search = String(options.search || '').trim().toLowerCase(); const consequence = options.consequenceNodeIds || null;
  presentation.nodes.forEach(node => {
    const position = layout.positions.get(node.id); if (!position) return;
    const searchable = `${node.id} ${node.sceneId || ''} ${node.choiceId || ''} ${node.endingId || ''} ${node.title || ''} ${node.sourceSceneIds?.join(' ') || ''} ${node.fragmentIds?.join(' ') || ''}`.toLowerCase();
    const dimmed = Boolean(consequence && !nodeInHighlightSet(node, consequence)) || Boolean(options.filterNode && !options.filterNode(node));
    layer.append(createCardNode(svg, node, position, { ...options, matched: search && searchable.includes(search), dimmed }));
  });
  svg.append(layer); wireHover(svg);
  svg.__heartlinePresentation = presentation; svg.__heartlineLayout = layout;
  host.replaceChildren(svg); return svg;
}

export function renderGraphOutline(host, model, options = {}) {
  const current = model.sceneNodes.find(node => node.sceneId === options.currentSceneId);
  const selectedChapter = options.selectedChapter || current?.chapterTitle || model.chapterOrder[0];
  host.innerHTML = model.chapterOrder.map(chapter => {
    const scenes = model.sceneNodes.filter(node => node.chapterTitle === chapter).sort((a, b) => a.order - b.order);
    return `<details class="graph-outline-chapter" ${chapter === selectedChapter ? 'open' : ''}><summary><span>${escapeHtml(chapter)}</span><b>${scenes.length}</b></summary><div class="graph-outline-list">${scenes.map(scene => {
      const decisions = model.decisions.filter(decision => decision.occurrences.some(item => item.sceneId === scene.sceneId));
      return `<div class="graph-outline-scene-wrap"><button class="graph-outline-scene ${scene.sceneId === options.currentSceneId ? 'active' : ''}" data-outline-node="${escapeHtml(scene.id)}"><span>${escapeHtml(scene.title)}</span><small>${escapeHtml(scene.code || scene.sceneId)}${scene.metrics?.reviews ? ` · ${scene.metrics.reviews} замеч.` : ''}</small></button>${decisions.map(decision => `<button class="graph-outline-choice" data-outline-decision="${escapeHtml(decision.id)}">◇ ${escapeHtml(decision.choiceId)} · ${escapeHtml(decision.title)}</button>`).join('')}</div>`;
    }).join('')}</div></details>`;
  }).join('');
  host.querySelectorAll('[data-outline-node]').forEach(button => button.addEventListener('click', () => { const node = model.nodes.find(item => item.id === button.dataset.outlineNode); if (node) options.onSelect?.(node); }));
  host.querySelectorAll('[data-outline-decision]').forEach(button => button.addEventListener('click', () => { const node = model.decisions.find(item => item.id === button.dataset.outlineDecision); if (node) options.onSelect?.({ ...node, kind: 'logicalDecision' }); }));
  host.querySelectorAll('.graph-outline-scene').forEach(button => button.addEventListener('dblclick', () => { const node = model.nodes.find(item => item.id === button.dataset.outlineNode); if (node) options.onOpen?.(node); }));
}

export function renderGraphMinimap(host, svg) {
  if (!host || !svg) return;
  const clone = svg.cloneNode(true); clone.removeAttribute('width'); clone.removeAttribute('height'); clone.style.transform = ''; clone.classList.add('graph-minimap-svg'); clone.querySelectorAll('foreignObject,text,title').forEach(node => node.remove()); host.replaceChildren(clone);
}
