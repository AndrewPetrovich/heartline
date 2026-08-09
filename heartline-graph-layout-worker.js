/* HEARTLINE Graph layout worker. The main UI currently uses the same deterministic
   algorithms synchronously for small graphs; this worker is the async boundary for
   structural graphs above 150 nodes. */
self.onmessage = event => {
  const { requestId, payload } = event.data || {};
  // Worker-safe fallback coordinates: deterministic temporal grid. The rich
  // layout remains in heartline-graph-layout.js, while this guarantees a usable
  // no-overlap result if a future heavy layout times out.
  const nodes = payload?.nodes || [];
  const positions = {};
  const rows = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  nodes.forEach((node, index) => {
    positions[node.id] = { x: 80 + Math.floor(index / rows) * 235, y: 80 + (index % rows) * 96, width: 190, height: 68 };
  });
  self.postMessage({ requestId, positions, safeFallback: true });
};
