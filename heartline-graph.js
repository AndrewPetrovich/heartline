import { buildStoryGraphModel, graphFixtureSummary } from './heartline-graph-model.js';
import { createPresentation, consequenceSet, presentationStats } from './heartline-graph-analysis.js';
import { layoutPresentation, clearGraphLayoutCache, measureLayoutQuality } from './heartline-graph-layout.js';
import { renderGraphPresentation, renderGraphOutline, renderGraphMinimap } from './heartline-graph-renderers.js';
import { enableGraphNavigation } from './heartline-graph-navigation.js';

export function buildGraph(content, assignments = [], reviews = [], options = {}) {
  return buildStoryGraphModel(content, assignments, reviews, options);
}

export function layoutGraph(model) {
  // Stable compatibility boundary. Specialized layout is calculated after the
  // requested view is known in renderGraph().
  return { model };
}

export function renderGraph(host, model, _layout, options = {}) {
  const presentation = createPresentation(model, {
    viewType: options.viewMode || 'story',
    search: options.search,
    decisionScope: options.decisionScope,
    routeMode: options.routeMode,
    reviewRouteId: options.reviewRouteId,
    weightMode: options.weightMode,
    hideSmall: options.hideSmall,
    minShare: options.minShare,
    densityMetric: options.densityMetric,
    groupMode: options.groupMode,
    maxNodes: options.maxNodes
  });
  const layout = layoutPresentation(presentation, {
    contentVersion: model.contentVersion,
    topologyHash: `${model.nodes.length}:${model.edges.length}:${model.fixture?.ok ? 'fixture-ok' : 'fixture-diff'}`,
    overridesHash: JSON.stringify(model.graphOverrides || {})
  });
  const svg = renderGraphPresentation(host, model, { presentation, layout }, {
    ...options,
    selectedNodeId: options.selectedNodeId,
    currentSceneId: options.currentSceneId,
    consequenceNodeIds: options.consequenceNodeIds
  });
  svg.__heartlineBundle = { presentation, layout };
  return svg;
}

export {
  renderGraphOutline,
  renderGraphMinimap,
  enableGraphNavigation,
  consequenceSet,
  graphFixtureSummary,
  presentationStats,
  clearGraphLayoutCache,
  measureLayoutQuality
};
