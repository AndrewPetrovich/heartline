import { buildGraph } from './heartline-graph.js';

const WORD_RE = /[A-Za-zА-Яа-яЁё0-9]+(?:[-’'][A-Za-zА-Яа-яЁё0-9]+)*/g;
const EFFECT_COMMANDS = new Set(['GOTO','SET','INC','DEC','ADD','SUB','FLAG','ROUTE','CHOICE','END','SYSTEM']);

export function countWords(value = '') {
  return (String(value || '').match(WORD_RE) || []).length;
}

function sourceText(step) {
  if (!step || step.type === 'tech') return '';
  return step.type === 'choice' ? (step.prompt || '') : (step.text || '');
}

function walkSteps(steps, visitor, context = {}) {
  for (const step of steps || []) {
    visitor(step, context);
    if (step.type === 'choice') {
      for (const option of step.options || []) {
        walkSteps(option.steps || [], visitor, { ...context, choice: step, option });
      }
    }
  }
}

function effectiveText(step, textEdits = {}) {
  if (Object.prototype.hasOwnProperty.call(textEdits || {}, step?.fragmentId)) return textEdits[step.fragmentId];
  return sourceText(step);
}

function optionHasSignificantEffect(option) {
  if (!option) return false;
  if (option.goto || option.fallbackGoto || option.targetBranch || option.condition) return true;
  let significant = false;
  walkSteps(option.steps || [], step => {
    if (step.type !== 'tech') significant = true;
    else if (EFFECT_COMMANDS.has(String(step.command || '').toUpperCase())) significant = true;
  });
  return significant;
}

function collectChoiceStats(content) {
  let choiceNodes = 0;
  let options = 0;
  let significant = 0;
  let flavor = 0;
  let branchPoints = 0;
  for (const scene of content.scenes || []) {
    walkSteps(scene.steps || [], step => {
      if (step.type !== 'choice') return;
      choiceNodes++;
      const opts = step.options || [];
      options += opts.length;
      let meaningfulHere = 0;
      const destinations = new Set();
      for (const option of opts) {
        const meaningful = optionHasSignificantEffect(option);
        if (meaningful) { significant++; meaningfulHere++; }
        else flavor++;
        const target = option.goto || option.fallbackGoto || option.targetBranch || '';
        if (target) destinations.add(String(target));
      }
      if (meaningfulHere >= 2 || destinations.size >= 2) branchPoints++;
    });
  }
  return { choiceNodes, options, significant, flavor, branchPoints };
}

function collectFramesAndWords(content, textEdits = {}) {
  let frames = 0;
  let words = 0;
  let optionBranchWords = 0;
  const sceneTopWords = new Map();
  const choiceWords = new Map();
  const optionWords = new Map();

  for (const scene of content.scenes || []) {
    let sceneWords = 0;
    for (const step of scene.steps || []) {
      if (step.type === 'tech') continue;
      if (step.type === 'choice') {
        frames++;
        const own = countWords(effectiveText(step, textEdits));
        const labels = (step.options || []).reduce((sum, option) => sum + countWords(option.label || ''), 0);
        const cw = own + labels;
        words += cw;
        choiceWords.set(`choice:${scene.id}:${step.id}`, cw);
        for (const option of step.options || []) {
          let ow = 0;
          walkSteps(option.steps || [], nested => {
            if (nested.type === 'tech') return;
            frames++;
            if (nested.type === 'choice') {
              const nestedOwn = countWords(effectiveText(nested, textEdits));
              const nestedLabels = (nested.options || []).reduce((sum, item) => sum + countWords(item.label || ''), 0);
              ow += nestedOwn + nestedLabels;
            } else {
              ow += countWords(effectiveText(nested, textEdits));
            }
          });
          optionBranchWords += ow;
          words += ow;
          optionWords.set(`${scene.id}:${step.id}:${option.id}`, ow);
        }
      } else {
        frames++;
        const w = countWords(effectiveText(step, textEdits));
        words += w;
        sceneWords += w;
      }
    }
    sceneTopWords.set(`scene:${scene.id}`, sceneWords);
  }
  return { frames, words, optionBranchWords, sceneTopWords, choiceWords, optionWords };
}

function detectEndings(content, graphModel) {
  const metaFinals = content.storyMetadata?.finals;
  if (Array.isArray(metaFinals) && metaFinals.length) {
    const typed = metaFinals.map(item => ({ id: item.id, type: item.endingType || item.type || null, title: item.title || item.id }));
    const secret = typed.filter(item => /secret|секрет/i.test(`${item.type || ''} ${item.title || ''}`)).length;
    const main = typed.filter(item => /main|основ/i.test(`${item.type || ''} ${item.title || ''}`)).length;
    return { total: typed.length, main: main || (secret ? typed.length - secret : null), secret: secret || null, items: typed };
  }

  const finalRouteIds = new Set((content.scenes || []).map(scene => scene.finalRoute).filter(Boolean));
  if (finalRouteIds.size) {
    return { total: finalRouteIds.size, main: null, secret: null, items: [...finalRouteIds].map(id => ({ id, type: null, title: id })) };
  }

  const endingNodes = (graphModel?.nodes || []).filter(node => node.kind === 'scene' && node.end);
  const epilogueScenes = (content.scenes || []).filter(scene => /(^|_)EP(?:_|$)|ENDING|END_/i.test(scene.id || ''));
  const ids = new Set([...endingNodes.map(node => node.sceneId), ...epilogueScenes.map(scene => scene.id)]);
  let secret = 0;
  for (const id of ids) if (/secret|секрет/i.test(id)) secret++;
  return { total: ids.size, main: ids.size ? (secret ? ids.size - secret : null) : 0, secret: secret || null, items: [...ids].map(id => ({ id, type: null, title: id })) };
}

function graphIndex(model) {
  const nodeById = new Map((model.nodes || []).map(node => [node.id, node]));
  const incoming = new Map((model.nodes || []).map(node => [node.id, []]));
  const outgoing = new Map((model.nodes || []).map(node => [node.id, []]));
  for (const edge of model.edges || []) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }
  return { nodeById, incoming, outgoing };
}

function reachableFrom(startId, outgoing) {
  const seen = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const edge of outgoing.get(id) || []) stack.push(edge.to);
  }
  return seen;
}

function commonNodesByDominators(model, startId) {
  const { nodeById, outgoing, incoming } = graphIndex(model);
  if (!nodeById.has(startId)) return new Set();
  const reachable = reachableFrom(startId, outgoing);
  const terminals = [...reachable].filter(id => !(outgoing.get(id) || []).some(edge => reachable.has(edge.to)));
  if (!terminals.length) return new Set([startId]);

  const sink = '__stats_sink__';
  const nodes = new Set([...reachable, sink]);
  const preds = new Map([...nodes].map(id => [id, []]));
  for (const id of reachable) {
    for (const edge of outgoing.get(id) || []) if (reachable.has(edge.to)) preds.get(edge.to).push(id);
  }
  for (const terminal of terminals) preds.get(sink).push(terminal);

  const all = new Set(nodes);
  const dom = new Map();
  for (const id of nodes) dom.set(id, id === startId ? new Set([startId]) : new Set(all));
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 500) {
    changed = false;
    for (const id of nodes) {
      if (id === startId) continue;
      const ps = preds.get(id) || [];
      if (!ps.length) continue;
      let intersection = new Set(dom.get(ps[0]) || []);
      for (let i = 1; i < ps.length; i++) {
        const next = dom.get(ps[i]) || new Set();
        intersection = new Set([...intersection].filter(value => next.has(value)));
      }
      intersection.add(id);
      const before = dom.get(id);
      if (before.size !== intersection.size || [...before].some(value => !intersection.has(value))) {
        dom.set(id, intersection);
        changed = true;
      }
    }
  }
  const common = new Set(dom.get(sink) || []);
  common.delete(sink);
  return common;
}

function approximateUniquePercent(content, model, wordData) {
  if (!wordData.words) return 0;
  const startId = `scene:${content.startScene}`;
  const commonNodes = commonNodesByDominators(model, startId);
  let commonWords = 0;
  for (const id of commonNodes) {
    commonWords += wordData.sceneTopWords.get(id) || 0;
    commonWords += wordData.choiceWords.get(id) || 0;
  }
  // Text nested inside an option is branch-specific by definition.
  const uniqueWords = Math.max(0, wordData.words - commonWords);
  return Math.max(0, Math.min(100, Math.round(uniqueWords / wordData.words * 100)));
}

function routeWordRange(content, model, wordData) {
  const target = content.storyMetadata?.targetRuntimeMinutes;
  if (target && Number.isFinite(Number(target.min)) && Number.isFinite(Number(target.max))) {
    return { min: Number(target.min), max: Number(target.max), source: 'metadata' };
  }
  const { nodeById, outgoing } = graphIndex(model);
  const startId = `scene:${content.startScene}`;
  if (!nodeById.has(startId)) return fallbackReadingRange(wordData.words);

  const nodeWeight = id => (wordData.sceneTopWords.get(id) || 0) + (wordData.choiceWords.get(id) || 0);
  const edgeExtra = edge => {
    if (edge.kind !== 'option' || !edge.optionId) return 0;
    const from = nodeById.get(edge.from);
    if (!from?.choiceId) return 0;
    return wordData.optionWords.get(`${from.sceneId}:${from.choiceId}:${edge.optionId}`) || 0;
  };

  const memo = new Map();
  const visiting = new Set();
  function visit(id) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return null;
    visiting.add(id);
    const outs = (outgoing.get(id) || []).filter(edge => nodeById.has(edge.to));
    const own = nodeWeight(id);
    if (!outs.length) {
      const leaf = { minWords: own, maxWords: own, minChoices: id.startsWith('choice:') ? 1 : 0, maxChoices: id.startsWith('choice:') ? 1 : 0 };
      memo.set(id, leaf); visiting.delete(id); return leaf;
    }
    const candidates = [];
    for (const edge of outs) {
      const child = visit(edge.to);
      if (!child) continue;
      const extra = edgeExtra(edge);
      candidates.push({
        minWords: own + extra + child.minWords,
        maxWords: own + extra + child.maxWords,
        minChoices: (id.startsWith('choice:') ? 1 : 0) + child.minChoices,
        maxChoices: (id.startsWith('choice:') ? 1 : 0) + child.maxChoices
      });
    }
    visiting.delete(id);
    if (!candidates.length) return null;
    const result = {
      minWords: Math.min(...candidates.map(item => item.minWords)),
      maxWords: Math.max(...candidates.map(item => item.maxWords)),
      minChoices: Math.min(...candidates.map(item => item.minChoices)),
      maxChoices: Math.max(...candidates.map(item => item.maxChoices))
    };
    memo.set(id, result);
    return result;
  }
  const path = visit(startId);
  if (!path || !path.maxWords) return fallbackReadingRange(wordData.words);
  const toMinutes = (words, choices) => words / 205 + choices * 0.10;
  const round5 = value => Math.max(5, Math.round(value / 5) * 5);
  let min = round5(toMinutes(path.minWords, path.minChoices));
  let max = round5(toMinutes(path.maxWords, path.maxChoices));
  if (max < min) [min, max] = [max, min];
  if (max === min) max = min + 5;
  return { min, max, source: 'graph' };
}

function fallbackReadingRange(words) {
  const round5 = value => Math.max(5, Math.round(value / 5) * 5);
  const mid = words / 205;
  return { min: round5(mid * .78), max: round5(mid), source: 'words' };
}

function countChapters(content) {
  const keys = new Set();
  for (const scene of content.scenes || []) keys.add(scene.chapterId || scene.chapterTitle || 'chapter');
  const numbered = [...keys].filter(key => /^CH\d+$/i.test(String(key)));
  return numbered.length || keys.size;
}

export function statisticsCacheKey(versionId, textEdits = {}) {
  const pairs = Object.entries(textEdits || {}).sort(([a], [b]) => a.localeCompare(b));
  let hash = 2166136261;
  const input = `${versionId || ''}|${JSON.stringify(pairs)}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `stats-v314:${versionId || 'version'}:${(hash >>> 0).toString(36)}`;
}

export function calculateProjectStatistics(content, textEdits = {}) {
  const graph = buildGraph(content, [], []);
  const words = collectFramesAndWords(content, textEdits);
  const choices = collectChoiceStats(content);
  const endings = detectEndings(content, graph);
  const uniqueContentPercent = approximateUniquePercent(content, graph, words);
  const readingTime = routeWordRange(content, graph, words);
  return {
    chapters: countChapters(content),
    scenes: (content.scenes || []).length,
    frames: words.frames,
    choices,
    endings,
    branches: choices.branchPoints,
    words: words.words,
    readingTime,
    uniqueContentPercent,
    calculatedAt: new Date().toISOString()
  };
}

export function formatInteger(value) {
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat('ru-RU').format(Number(value)) : '—';
}
