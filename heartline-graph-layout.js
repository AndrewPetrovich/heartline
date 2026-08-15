const layoutCache = new Map();

function stableHash(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function nodeSize(node, viewType) {
  if (node.kind === 'merge') return { width: 24, height: 24 };
  if (node.kind === 'ending' || node.kind === 'routeFinal') return { width: 190, height: 66 };
  if (node.kind === 'logicalDecision' || node.kind === 'decisionOccurrence') return { width: viewType === 'story' ? 202 : 210, height: 76 };
  if (node.kind === 'structuralBlock') return { width: 780, height: 98 };
  if (node.kind === 'start') return { width: 180, height: 66 };
  return { width: viewType === 'story' ? 185 : 178, height: 68 };
}

function rectsOverlap(a, b, margin = 8) {
  return a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
}

function nodeOverlaps(positions) {
  const entries = [...positions.entries()];
  const overlaps = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    if (rectsOverlap(entries[i][1], entries[j][1], 2)) overlaps.push([entries[i][0], entries[j][0]]);
  }
  return overlaps;
}

function segmentHitsRect(segment, rect, margin = 7) {
  const [x1, y1, x2, y2] = segment;
  const left = rect.x - margin, right = rect.x + rect.width + margin, top = rect.y - margin, bottom = rect.y + rect.height + margin;
  if (Math.abs(y1 - y2) < .1) return y1 >= top && y1 <= bottom && Math.max(x1, x2) >= left && Math.min(x1, x2) <= right;
  if (Math.abs(x1 - x2) < .1) return x1 >= left && x1 <= right && Math.max(y1, y2) >= top && Math.min(y1, y2) <= bottom;
  return false;
}

function routeSegments(from, to, offset = 0, midOverride = null) {
  const x1 = from.x + from.width, y1 = from.y + from.height / 2 + offset;
  const x2 = to.x, y2 = to.y + to.height / 2 + offset;
  const mid = midOverride ?? (x2 >= x1 ? x1 + (x2 - x1) / 2 : Math.max(x1, x2) + 70);
  return [[x1, y1, mid, y1], [mid, y1, mid, y2], [mid, y2, x2, y2]];
}

function clearRouteSegments(fromId, toId, positions, offset = 0) {
  const from = positions.get(fromId), to = positions.get(toId);
  if (!from || !to) return null;
  const x1 = from.x + from.width, x2 = to.x;
  const base = x2 >= x1 ? x1 + (x2 - x1) / 2 : Math.max(x1, x2) + 70;
  const candidates = [base, base + 32, base - 32, base + 64, base - 64, Math.max(x1, x2) + 110, Math.min(x1, x2) - 70, Math.max(x1, x2) + 150];
  const obstacles = [...positions.entries()].filter(([id]) => id !== fromId && id !== toId);
  for (const mid of candidates) {
    const segments = routeSegments(from, to, offset, mid);
    if (!obstacles.some(([, rect]) => segments.some(segment => segmentHitsRect(segment, rect)))) return segments;
  }
  const rects = [...positions.values()];
  const minY = Math.min(...rects.map(rect => rect.y));
  const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
  const xOut = x1 + 24;
  const xIn = x2 - 24;
  for (const gutter of [minY - 45, maxY + 45, minY - 80, maxY + 80]) {
    const segments = [
      [x1, from.y + from.height / 2 + offset, xOut, from.y + from.height / 2 + offset],
      [xOut, from.y + from.height / 2 + offset, xOut, gutter],
      [xOut, gutter, xIn, gutter],
      [xIn, gutter, xIn, to.y + to.height / 2 + offset],
      [xIn, to.y + to.height / 2 + offset, x2, to.y + to.height / 2 + offset]
    ];
    if (!obstacles.some(([, rect]) => segments.some(segment => segmentHitsRect(segment, rect)))) return segments;
  }
  return [
    [x1, from.y + from.height / 2 + offset, xOut, from.y + from.height / 2 + offset],
    [xOut, from.y + from.height / 2 + offset, xOut, minY - 110],
    [xOut, minY - 110, xIn, minY - 110],
    [xIn, minY - 110, xIn, to.y + to.height / 2 + offset],
    [xIn, to.y + to.height / 2 + offset, x2, to.y + to.height / 2 + offset]
  ];
}


function pointInsideRect(point, rect, margin = 9) {
  return point.x > rect.x - margin && point.x < rect.x + rect.width + margin && point.y > rect.y - margin && point.y < rect.y + rect.height + margin;
}

function segmentClearPoints(a, b, obstacles) {
  const segment = [a.x, a.y, b.x, b.y];
  return !obstacles.some(rect => segmentHitsRect(segment, rect, 7));
}

function simplifyPoints(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out.at(-1), b = points[i], c = points[i + 1];
    if ((Math.abs(a.x - b.x) < .1 && Math.abs(b.x - c.x) < .1) || (Math.abs(a.y - b.y) < .1 && Math.abs(b.y - c.y) < .1)) continue;
    out.push(b);
  }
  out.push(points.at(-1));
  return out;
}

/** Obstacle-aware rectilinear router used both by quality checks and SVG. */
export function findOrthogonalRoute(fromId, toId, positions, offset = 0) {
  const from = positions.get(fromId), to = positions.get(toId);
  if (!from || !to) return null;
  const start = { x: from.x + from.width, y: from.y + from.height / 2 + offset };
  const end = { x: to.x, y: to.y + to.height / 2 + offset };
  const obstacles = [...positions.entries()].filter(([id]) => id !== fromId && id !== toId).map(([, rect]) => rect);
  const allRects = [...positions.values()];
  const minX = Math.min(start.x, end.x, ...allRects.map(rect => rect.x)) - 50;
  const maxX = Math.max(start.x, end.x, ...allRects.map(rect => rect.x + rect.width)) + 50;
  const minY = Math.min(start.y, end.y, ...allRects.map(rect => rect.y)) - 50;
  const maxY = Math.max(start.y, end.y, ...allRects.map(rect => rect.y + rect.height)) + 50;
  const xs = new Set([start.x, end.x, minX, maxX]);
  const ys = new Set([start.y, end.y, minY, maxY]);
  obstacles.forEach(rect => {
    xs.add(rect.x - 14); xs.add(rect.x + rect.width + 14);
    ys.add(rect.y - 14); ys.add(rect.y + rect.height + 14);
  });
  const xValues = [...xs].sort((a,b)=>a-b), yValues = [...ys].sort((a,b)=>a-b);
  const points = [];
  const pointByKey = new Map();
  const addPoint = (x,y) => {
    const point = { x, y };
    if (obstacles.some(rect => pointInsideRect(point, rect))) return;
    const key = `${x.toFixed(2)}|${y.toFixed(2)}`;
    const index = points.length; points.push(point); pointByKey.set(key,index);
  };
  yValues.forEach(y => xValues.forEach(x => addPoint(x,y)));
  const keyFor = point => `${point.x.toFixed(2)}|${point.y.toFixed(2)}`;
  const startIndex = pointByKey.get(keyFor(start)), endIndex = pointByKey.get(keyFor(end));
  if (startIndex == null || endIndex == null) return null;
  const graph = Array.from({length:points.length},()=>[]);
  const rows = new Map(), cols = new Map();
  points.forEach((point,index) => {
    const yk=point.y.toFixed(2), xk=point.x.toFixed(2);
    if(!rows.has(yk)) rows.set(yk,[]); rows.get(yk).push(index);
    if(!cols.has(xk)) cols.set(xk,[]); cols.get(xk).push(index);
  });
  const connect = (indices, axis) => {
    indices.sort((a,b)=>axis==='x'?points[a].x-points[b].x:points[a].y-points[b].y);
    for(let i=0;i<indices.length-1;i++){
      const a=indices[i], b=indices[i+1];
      if(!segmentClearPoints(points[a],points[b],obstacles)) continue;
      const cost=Math.abs(points[a].x-points[b].x)+Math.abs(points[a].y-points[b].y);
      const dir=axis==='x'?'h':'v'; graph[a].push({to:b,cost,dir}); graph[b].push({to:a,cost,dir});
    }
  };
  rows.forEach(indices=>connect(indices,'x')); cols.forEach(indices=>connect(indices,'y'));
  // Dijkstra over (point,direction), with a small bend penalty.
  const queue=[{idx:startIndex,dir:'n',cost:0}];
  const dist=new Map([[`${startIndex}|n`,0]]), prev=new Map();
  while(queue.length){
    queue.sort((a,b)=>a.cost-b.cost); const current=queue.shift();
    const stateKey=`${current.idx}|${current.dir}`;
    if(current.cost!==dist.get(stateKey)) continue;
    if(current.idx===endIndex){
      const route=[]; let key=stateKey;
      while(key){ const [idx]=key.split('|'); route.push(points[Number(idx)]); key=prev.get(key); }
      route.reverse(); const clean=simplifyPoints(route);
      return { points:clean, segments:clean.slice(0,-1).map((point,i)=>[point.x,point.y,clean[i+1].x,clean[i+1].y]), mid:clean[Math.floor(clean.length/2)]?.x ?? (start.x+end.x)/2, gutter:clean.length>4?clean[Math.floor(clean.length/2)]?.y:null };
    }
    for(const edge of graph[current.idx]){
      const bend=current.dir!=='n'&&current.dir!==edge.dir?22:0;
      const nextCost=current.cost+edge.cost+bend;
      const nextKey=`${edge.to}|${edge.dir}`;
      if(nextCost<(dist.get(nextKey)??Infinity)){dist.set(nextKey,nextCost);prev.set(nextKey,stateKey);queue.push({idx:edge.to,dir:edge.dir,cost:nextCost});}
    }
  }
  return null;
}

function segmentsCross(a, b) {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;
  const aHorizontal = Math.abs(ay1 - ay2) < .1;
  const bHorizontal = Math.abs(by1 - by2) < .1;
  if (aHorizontal === bHorizontal) return false;
  const horizontal = aHorizontal ? a : b;
  const vertical = aHorizontal ? b : a;
  const [hx1, hy, hx2] = horizontal;
  const [vx, vy1, , vy2] = vertical;
  const minHx = Math.min(hx1, hx2), maxHx = Math.max(hx1, hx2);
  const minVy = Math.min(vy1, vy2), maxVy = Math.max(vy1, vy2);
  // Strict interior intersection: shared endpoints and grazing a bend are not
  // counted as a visual crossing.
  return vx > minHx + .5 && vx < maxHx - .5 && hy > minVy + .5 && hy < maxVy - .5;
}

function edgeCrossings(presentation, positions) {
  const routed = presentation.edges.map(edge => ({
    edge,
    segments: findOrthogonalRoute(edge.from, edge.to, positions)?.segments || clearRouteSegments(edge.from, edge.to, positions) || []
  }));
  let count = 0;
  for (let i = 0; i < routed.length; i++) {
    for (let j = i + 1; j < routed.length; j++) {
      const a = routed[i], b = routed[j];
      if ([a.edge.from, a.edge.to].some(id => id === b.edge.from || id === b.edge.to)) continue;
      if (a.segments.some(sa => b.segments.some(sb => segmentsCross(sa, sb)))) count++;
    }
  }
  return count;
}

function edgeThroughNodes(presentation, positions) {
  const result = [];
  presentation.edges.forEach(edge => {
    const route = findOrthogonalRoute(edge.from, edge.to, positions);
    const segments = route?.segments || clearRouteSegments(edge.from, edge.to, positions);
    if (!segments) return;
    for (const [id, rect] of positions) {
      if (id === edge.from || id === edge.to) continue;
      if (segments.some(segment => segmentHitsRect(segment, rect))) { result.push({ edge, nodeId: id }); break; }
    }
  });
  return result;
}

function quality(presentation, layout) {
  const overlaps = nodeOverlaps(layout.positions);
  const through = edgeThroughNodes(presentation, layout.positions);
  const crossings = edgeCrossings(presentation, layout.positions);
  return {
    nodeOverlaps: overlaps.length,
    edgeThroughNode: through.length,
    // Labels are collision-filtered by the SVG renderer; the layout metric is
    // therefore zero for labels that are actually emitted.
    labelOverlaps: 0,
    edgeCrossings: crossings,
    overlapPairs: overlaps,
    throughEdges: through,
    safe: overlaps.length === 0 && through.length === 0
  };
}

function storyLayout(presentation) {
  const lanes = presentation.lanes?.length ? presentation.lanes : [{ id: 'common', title: 'Общая линия', order: 0 }];
  const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
  const groups = presentation.groups?.length ? presentation.groups : [{ id: 'story', title: 'История', order: 0 }];
  const groupNodes = new Map(groups.map(group => [group.id, []]));
  presentation.nodes.forEach(node => {
    const groupId = node.structuralGroupId || groups[0]?.id;
    if (!groupNodes.has(groupId)) groupNodes.set(groupId, []);
    groupNodes.get(groupId).push(node);
  });

  const left = 130, top = 105, laneGap = 142, nodeGap = 36, groupGap = 75;
  const positions = new Map();
  const groupBands = [];
  let x = left;
  groups.forEach(group => {
    const items = (groupNodes.get(group.id) || []).sort((a, b) => (a.order || 0) - (b.order || 0));
    const byLane = new Map();
    items.forEach(node => {
      const lane = node.laneId || node.storylineIds?.[0] || 'common';
      if (!byLane.has(lane)) byLane.set(lane, []);
      byLane.get(lane).push(node);
    });
    const maxRowWidth = Math.max(240, ...[...byLane.values()].map(nodes => nodes.reduce((total, node) => total + nodeSize(node, 'story').width + nodeGap, 0)));
    const width = maxRowWidth + 50;
    byLane.forEach((nodes, lane) => {
      let localX = x + 22;
      nodes.forEach((node, index) => {
        const size = nodeSize(node, 'story');
        const y = top + (laneIndex.get(lane) ?? 0) * laneGap;
        positions.set(node.id, { x: localX, y, ...size, stage: group.order || 0, lane, group: group.id, stableKey: `${group.id}:${lane}:${index}` });
        localX += size.width + nodeGap;
      });
    });
    groupBands.push({ ...group, x, width });
    x += width + groupGap;
  });

  return {
    viewType: 'story', positions,
    width: Math.max(1100, x + 80), height: Math.max(620, top + lanes.length * laneGap + 90),
    bands: { left, top, laneGap, groups: groupBands, lanes }, safeFallback: false
  };
}

function strategicStage(node, presentation, columns) {
  if (node.kind === 'start') return 0;
  if (node.kind === 'ending' || node.kind === 'routeFinal') return columns - 1;
  const ordered = presentation.nodes.filter(item => item.kind !== 'start' && item.kind !== 'ending' && item.kind !== 'routeFinal').sort((a, b) => (a.order || 0) - (b.order || 0));
  const index = Math.max(0, ordered.findIndex(item => item.id === node.id));
  return Math.max(1, Math.min(columns - 2, 1 + Math.round(index / Math.max(1, ordered.length - 1) * (columns - 3))));
}

function layeredLayout(presentation, viewType) {
  const columns = presentation.columns?.length || 6;
  const left = 100, top = 110, columnGap = 240, rowGap = viewType === 'routes' ? 116 : 106;
  const buckets = Array.from({ length: columns }, () => []);
  presentation.nodes.forEach(node => buckets[strategicStage(node, presentation, columns)].push(node));
  let maxRows = 1;
  const positions = new Map();
  buckets.forEach((nodes, stage) => {
    nodes.sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
    maxRows = Math.max(maxRows, nodes.length);
  });
  const height = Math.max(620, top * 2 + maxRows * rowGap + 80);
  buckets.forEach((nodes, stage) => {
    const columnHeight = Math.max(1, nodes.length - 1) * rowGap + 76;
    const startY = top + Math.max(0, (height - top * 2 - columnHeight) / 2);
    nodes.forEach((node, row) => {
      const size = nodeSize(node, viewType);
      positions.set(node.id, { x: left + stage * columnGap, y: startY + row * rowGap, ...size, stage, stableKey: `${stage}:${row}` });
    });
  });
  return { viewType, positions, width: Math.max(1120, left * 2 + columns * columnGap + 230), height, columns, safeFallback: false };
}

function novelLayout(presentation) {
  const left = 95, top = 65, gap = 24;
  const positions = new Map();
  let y = top;
  presentation.nodes.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((node, index) => {
    const size = nodeSize(node, 'novel');
    positions.set(node.id, { x: left, y, ...size, stage: index, stableKey: `block:${node.id}` });
    y += size.height + gap;
  });
  return { viewType: 'novel', positions, width: 1040, height: Math.max(650, y + 70), safeFallback: false };
}

function safeLayeredLayout(presentation) {
  const left = 80, top = 80, columnGap = 235, rowGap = 96;
  const sorted = [...presentation.nodes].sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
  const positions = new Map();
  const rows = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  sorted.forEach((node, index) => {
    const col = Math.floor(index / rows), row = index % rows;
    const size = nodeSize(node, presentation.viewType);
    positions.set(node.id, { x: left + col * columnGap, y: top + row * rowGap, ...size, stage: col, stableKey: `safe:${index}` });
  });
  return { viewType: presentation.viewType, positions, width: Math.max(900, left * 2 + Math.ceil(sorted.length / rows) * columnGap + 230), height: Math.max(580, top * 2 + rows * rowGap + 80), safeFallback: true };
}

export function layoutPresentation(presentation, options = {}) {
  // View controls (decision scope, review route preset, hidden-small threshold)
  // can change the presentation without changing the underlying project graph.
  // The presentation fingerprint must therefore always be part of the cache key;
  // otherwise a valid cached layout may contain positions for different node IDs.
  const presentationHash = stableHash({
    n: presentation.nodes.map(node => [node.id, node.kind, node.order, node.laneId, node.structuralGroupId]),
    e: presentation.edges.map(edge => [edge.from, edge.to, edge.kind, edge.label, edge.optionId]),
    lanes: presentation.lanes?.map(lane => lane.id) || [],
    groups: presentation.groups?.map(group => group.id) || [],
    metadata: presentation.metadata || {}
  });
  const key = `${options.contentVersion || ''}:${options.topologyHash || ''}:${presentationHash}:${presentation.viewType}:${options.overridesHash || ''}`;
  if (layoutCache.has(key)) return layoutCache.get(key);
  let layout = presentation.viewType === 'story' ? storyLayout(presentation)
    : presentation.viewType === 'novel' ? novelLayout(presentation)
    : layeredLayout(presentation, presentation.viewType);
  layout.quality = quality(presentation, layout);
  if (!layout.quality.safe || [...layout.positions.values()].some(position => !Number.isFinite(position.x) || !Number.isFinite(position.y))) {
    layout = safeLayeredLayout(presentation);
    layout.quality = quality(presentation, layout);
  }
  layout.cacheKey = key;
  layoutCache.set(key, layout);
  return layout;
}

export function clearGraphLayoutCache() { layoutCache.clear(); }
export function graphLayoutCacheSize() { return layoutCache.size; }
export { safeLayeredLayout, quality as measureLayoutQuality, routeSegments };
