export const PROOFREADING_FORMAT_VERSION = 1;

export const DEFAULT_PASSES = Object.freeze([
  { id: 'read', label: 'Первичное чтение', description: 'Смысл, естественность, очевидные ошибки.', enabled: true },
  { id: 'proof', label: 'Орфография и пунктуация', description: 'Орфография, пунктуация, пробелы, типографика.', enabled: true },
  { id: 'style', label: 'Стиль', description: 'Повторы, ритм, диалоги, голос персонажей.', enabled: true },
  { id: 'continuity', label: 'Логика и continuity', description: 'Факты, последовательность, ветки и персонажи.', enabled: true },
  { id: 'final', label: 'Финальная проверка', description: 'Последний проход по уже исправленному тексту.', enabled: true }
]);

export const UNIT_STATES = Object.freeze(['not-started', 'in-progress', 'attention', 'reviewed', 'approved', 'changed']);
export const REVIEW_WORKFLOW_STATES = Object.freeze(['open', 'fix-proposed', 'verify', 'resolved', 'wont-fix']);

export const TEXT_REVIEW_CATEGORIES = Object.freeze([
  'Орфография', 'Пунктуация', 'Грамматика', 'Стиль', 'Диалог', 'Логика', 'Continuity',
  'Темп', 'Персонаж', 'Повтор', 'Терминология', 'Факт/деталь', 'Другое'
]);

export const DEFAULT_RULES = Object.freeze({
  doubleSpaces: true,
  spaceBeforePunctuation: true,
  repeatedWords: true,
  mixedScripts: true,
  straightQuotes: true,
  dashStyle: true,
  trailingWhitespace: true,
  repeatedPunctuation: false,
  russianQuotes: true
});

const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function reviewFingerprint(value) {
  const text = String(value ?? '');
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i++) {
    let code = BigInt(text.charCodeAt(i));
    hash ^= code & 0xffn;
    hash = BigInt.asUintN(64, hash * prime);
    hash ^= (code >> 8n) & 0xffn;
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

export function createDefaultProofreadingState(now = new Date().toISOString()) {
  return {
    formatVersion: PROOFREADING_FORMAT_VERSION,
    activePassId: 'read',
    passes: DEFAULT_PASSES.map(pass => ({ ...pass })),
    units: {},
    dictionary: { terms: [], ignoredWords: [], forbiddenWords: [] },
    rules: { ...DEFAULT_RULES },
    ignoredFindingKeys: [],
    updatedAt: now
  };
}

export function normalizeProofreadingState(value, now = new Date().toISOString()) {
  const base = createDefaultProofreadingState(now);
  if (!value || typeof value !== 'object') return base;
  const passes = Array.isArray(value.passes) && value.passes.length
    ? value.passes.map(pass => ({
        id: String(pass.id || ''),
        label: String(pass.label || pass.id || 'Проход'),
        description: String(pass.description || ''),
        enabled: pass.enabled !== false
      })).filter(pass => pass.id)
    : base.passes;
  const passIds = new Set(passes.map(pass => pass.id));
  const units = {};
  for (const [fragmentId, record] of Object.entries(value.units || {})) {
    const passRecords = {};
    for (const [passId, passRecord] of Object.entries(record?.passes || {})) {
      if (!passIds.has(passId)) continue;
      passRecords[passId] = {
        status: ['reviewed', 'approved'].includes(passRecord?.status) ? passRecord.status : 'reviewed',
        reviewedHash: passRecord?.reviewedHash || null,
        reviewedAt: passRecord?.reviewedAt || null
      };
    }
    units[fragmentId] = { passes: passRecords, updatedAt: record?.updatedAt || null };
  }
  const activePassId = passIds.has(value.activePassId) && passes.find(pass => pass.id === value.activePassId)?.enabled !== false
    ? value.activePassId
    : passes.find(pass => pass.enabled)?.id || passes[0]?.id || 'read';
  return {
    formatVersion: PROOFREADING_FORMAT_VERSION,
    activePassId,
    passes,
    units,
    dictionary: normalizeDictionary(value.dictionary),
    rules: { ...DEFAULT_RULES, ...(value.rules || {}) },
    ignoredFindingKeys: Array.isArray(value.ignoredFindingKeys) ? [...new Set(value.ignoredFindingKeys.map(String))] : [],
    updatedAt: value.updatedAt || now
  };
}

export function normalizeDictionary(value = {}) {
  const terms = Array.isArray(value.terms) ? value.terms.map(term => ({
    id: String(term.id || ''),
    canonical: String(term.canonical || '').trim(),
    variants: Array.isArray(term.variants) ? [...new Set(term.variants.map(item => String(item).trim()).filter(Boolean))] : [],
    caseSensitive: Boolean(term.caseSensitive),
    note: String(term.note || '')
  })).filter(term => term.id && term.canonical) : [];
  return {
    terms,
    ignoredWords: Array.isArray(value.ignoredWords) ? [...new Set(value.ignoredWords.map(item => String(item).trim()).filter(Boolean))] : [],
    forbiddenWords: Array.isArray(value.forbiddenWords) ? [...new Set(value.forbiddenWords.map(item => String(item).trim()).filter(Boolean))] : []
  };
}

export function workflowStatusFromLegacy(review) {
  if (REVIEW_WORKFLOW_STATES.includes(review?.workflowStatus)) return review.workflowStatus;
  const legacy = String(review?.status || 'Открыто');
  if (legacy === 'Принято' || legacy === 'Архив') return 'resolved';
  if (legacy === 'Отклонено') return 'wont-fix';
  if (legacy === 'Требует проверки' || legacy === 'GPT исправил') return 'verify';
  if (legacy === 'Передано GPT') return 'fix-proposed';
  return 'open';
}

export function legacyStatusFromWorkflow(status) {
  return ({
    open: 'Открыто',
    'fix-proposed': 'Передано GPT',
    verify: 'Требует проверки',
    resolved: 'Принято',
    'wont-fix': 'Отклонено'
  })[status] || 'Открыто';
}

export function isReviewOpen(review) {
  return !['resolved', 'wont-fix'].includes(workflowStatusFromLegacy(review));
}

export function deriveUnitState({ state, fragmentId, passId, currentText, reviews = [] }) {
  const record = state?.units?.[fragmentId]?.passes?.[passId] || null;
  const currentHash = reviewFingerprint(currentText);
  const openReviews = reviews.filter(review => review.fragmentId === fragmentId && review.targetType !== 'image' && isReviewOpen(review));
  if (openReviews.length) return { status: 'attention', currentHash, record, openReviews };
  if (!record?.reviewedHash) return { status: 'not-started', currentHash, record, openReviews };
  if (record.reviewedHash !== currentHash) return { status: 'changed', currentHash, record, openReviews };
  return { status: record.status === 'approved' ? 'approved' : 'reviewed', currentHash, record, openReviews };
}

export function markUnitPass(state, fragmentId, passId, currentText, at, approved = false) {
  const next = normalizeProofreadingState(clone(state), at);
  next.units[fragmentId] ||= { passes: {}, updatedAt: at };
  next.units[fragmentId].passes ||= {};
  next.units[fragmentId].passes[passId] = {
    status: approved ? 'approved' : 'reviewed',
    reviewedHash: reviewFingerprint(currentText),
    reviewedAt: at
  };
  next.units[fragmentId].updatedAt = at;
  next.updatedAt = at;
  return next;
}

export function createTextAnchor({ text, startOffset, endOffset, at = null }) {
  const source = String(text ?? '');
  const start = Math.max(0, Math.min(source.length, Number(startOffset) || 0));
  const end = Math.max(start, Math.min(source.length, Number(endOffset) || start));
  const quotedText = source.slice(start, end);
  return {
    startOffset: start,
    endOffset: end,
    quotedText,
    prefix: source.slice(Math.max(0, start - 32), start),
    suffix: source.slice(end, Math.min(source.length, end + 32)),
    fragmentHash: reviewFingerprint(source),
    createdAt: at
  };
}

export function resolveTextAnchor(text, anchor) {
  const source = String(text ?? '');
  if (!anchor) return { status: 'missing', startOffset: null, endOffset: null };
  const quoted = String(anchor.quotedText || '');
  const start = Number(anchor.startOffset);
  const end = Number(anchor.endOffset);
  if (Number.isInteger(start) && Number.isInteger(end) && source.slice(start, end) === quoted) {
    return { status: anchor.fragmentHash === reviewFingerprint(source) ? 'exact' : 'shift-safe', startOffset: start, endOffset: end };
  }
  if (!quoted) return { status: 'stale', startOffset: null, endOffset: null };
  const candidates = [];
  let index = source.indexOf(quoted);
  while (index >= 0) {
    candidates.push(index);
    index = source.indexOf(quoted, index + Math.max(1, quoted.length));
  }
  if (!candidates.length) return { status: 'stale', startOffset: null, endOffset: null };
  if (candidates.length === 1) return { status: 'relocated', startOffset: candidates[0], endOffset: candidates[0] + quoted.length };
  const prefix = String(anchor.prefix || '');
  const suffix = String(anchor.suffix || '');
  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    let score = 0;
    if (prefix && source.slice(Math.max(0, candidate - prefix.length), candidate) === prefix) score += 2;
    if (suffix && source.slice(candidate + quoted.length, candidate + quoted.length + suffix.length) === suffix) score += 2;
    const distance = Number.isFinite(start) ? Math.abs(candidate - start) : source.length;
    score += 1 / (1 + distance);
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return bestScore >= 2 ? { status: 'relocated', startOffset: best, endOffset: best + quoted.length } : { status: 'ambiguous', startOffset: null, endOffset: null };
}

export function flattenProofreadingUnits(content) {
  const units = [];
  for (const [sceneIndex, scene] of (content?.scenes || []).entries()) {
    const walk = (steps, path = []) => {
      for (const [stepIndex, step] of (steps || []).entries()) {
        const nextPath = [...path, stepIndex];
        if (step.type !== 'tech') {
          units.push({
            fragmentId: step.fragmentId,
            sceneId: scene.id,
            sceneTitle: scene.title || scene.id,
            chapterId: scene.chapterId || `chapter:${scene.chapterTitle || 'other'}`,
            chapterTitle: scene.chapterTitle || scene.chapterId || 'Без главы',
            sceneOrder: scene.order ?? sceneIndex,
            path: nextPath,
            type: step.type,
            speaker: step.speaker || '',
            sourceText: step.type === 'choice' ? (step.prompt || '') : (step.text || '')
          });
        }
        if (step.type === 'choice') for (const [optionIndex, option] of (step.options || []).entries()) walk(option.steps || [], [...nextPath, optionIndex]);
      }
    };
    walk(scene.steps || []);
  }
  return units;
}

export function aggregateStatuses(items) {
  const total = items.length;
  const counts = { 'not-started': 0, 'in-progress': 0, attention: 0, reviewed: 0, approved: 0, changed: 0 };
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  const completed = counts.reviewed + counts.approved;
  let status = 'not-started';
  if (counts.attention) status = 'attention';
  else if (counts.changed) status = 'changed';
  else if (total && completed === total) status = counts.approved === total ? 'approved' : 'reviewed';
  else if (completed || counts['in-progress']) status = 'in-progress';
  return { total, completed, percent: total ? Math.round(completed / total * 100) : 0, counts, status };
}

function addFinding(findings, finding) {
  const key = `${finding.code}:${finding.startOffset}:${finding.endOffset}:${finding.message}`;
  if (findings.some(item => item.key === key)) return;
  findings.push({ ...finding, key });
}

export function runDeterministicChecks(text, stateOrConfig = {}) {
  const source = String(text ?? '');
  const state = stateOrConfig?.rules ? stateOrConfig : { rules: stateOrConfig, dictionary: {} };
  const rules = { ...DEFAULT_RULES, ...(state.rules || {}) };
  const dictionary = normalizeDictionary(state.dictionary || {});
  const ignoredFindingKeys = new Set(state.ignoredFindingKeys || []);
  const findings = [];
  const push = finding => {
    const candidate = { severity: 'warning', replacement: null, ...finding };
    const key = `${candidate.code}:${candidate.startOffset}:${candidate.endOffset}:${candidate.message}`;
    if (!ignoredFindingKeys.has(key)) addFinding(findings, candidate);
  };

  if (rules.doubleSpaces) {
    for (const match of source.matchAll(/ {2,}/g)) push({ code: 'double-space', startOffset: match.index, endOffset: match.index + match[0].length, message: 'Несколько пробелов подряд.', replacement: ' ' });
  }
  if (rules.spaceBeforePunctuation) {
    for (const match of source.matchAll(/[ \t]+([,.;:!?])/g)) push({ code: 'space-before-punctuation', startOffset: match.index, endOffset: match.index + match[0].length, message: 'Пробел перед знаком пунктуации.', replacement: match[1] });
  }
  if (rules.trailingWhitespace) {
    for (const match of source.matchAll(/[ \t]+$/gm)) push({ code: 'trailing-whitespace', startOffset: match.index, endOffset: match.index + match[0].length, message: 'Пробелы в конце строки.', replacement: '' });
  }
  if (rules.repeatedWords) {
    const word = /[\p{L}\p{N}Ёё’'-]+/gu;
    const tokens = [...source.matchAll(word)];
    for (let i = 1; i < tokens.length; i++) {
      const a = tokens[i - 1], b = tokens[i];
      if (a[0].toLocaleLowerCase('ru-RU') !== b[0].toLocaleLowerCase('ru-RU')) continue;
      const between = source.slice(a.index + a[0].length, b.index);
      if (!/^\s+$/.test(between)) continue;
      push({ code: 'repeated-word', startOffset: b.index, endOffset: b.index + b[0].length, message: `Повтор слова «${b[0]}».`, replacement: '' });
    }
  }
  if (rules.mixedScripts) {
    for (const match of source.matchAll(/[\p{L}\p{N}_-]+/gu)) {
      if (/[A-Za-z]/.test(match[0]) && /[А-Яа-яЁё]/.test(match[0])) push({ code: 'mixed-scripts', startOffset: match.index, endOffset: match.index + match[0].length, message: `В слове «${match[0]}» смешаны кириллица и латиница.`, severity: 'error' });
    }
  }
  if (rules.straightQuotes && rules.russianQuotes) {
    for (const match of source.matchAll(/"/g)) push({ code: 'straight-quote', startOffset: match.index, endOffset: match.index + 1, message: 'Прямая кавычка в русском тексте. Проверьте «ёлочки».', replacement: null });
  }
  if (rules.dashStyle) {
    for (const match of source.matchAll(/\s-\s/g)) push({ code: 'dash-style', startOffset: match.index, endOffset: match.index + match[0].length, message: 'Дефис между пробелами; возможно, требуется тире.', replacement: ' — ' });
  }
  if (rules.repeatedPunctuation) {
    for (const match of source.matchAll(/([!?])\1{2,}/g)) push({ code: 'repeated-punctuation', startOffset: match.index, endOffset: match.index + match[0].length, message: 'Три и более одинаковых знака пунктуации подряд.', replacement: match[1] });
  }

  for (const term of dictionary.terms) {
    for (const variant of term.variants) {
      if (!variant || variant === term.canonical) continue;
      const flags = term.caseSensitive ? 'gu' : 'giu';
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(variant)}(?![\\p{L}\\p{N}_])`, flags);
      for (const match of source.matchAll(re)) push({ code: 'terminology', startOffset: match.index, endOffset: match.index + match[0].length, message: `Используйте «${term.canonical}» вместо «${match[0]}».${term.note ? ` ${term.note}` : ''}`, replacement: term.canonical, severity: 'warning' });
    }
  }
  for (const forbidden of dictionary.forbiddenWords) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(forbidden)}(?![\\p{L}\\p{N}_])`, 'giu');
    for (const match of source.matchAll(re)) push({ code: 'forbidden-word', startOffset: match.index, endOffset: match.index + match[0].length, message: `Нежелательное слово/форма: «${match[0]}».`, severity: 'warning' });
  }

  return findings.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
}

export function validateRegexPattern(pattern) {
  const value = String(pattern || '');
  if (!value) throw new Error('Пустое регулярное выражение');
  if (value.length > 160) throw new Error('Регулярное выражение слишком длинное');
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(value) || /\([^)]*\{\d+,?\d*\}[^)]*\)[+*{]/.test(value)) throw new Error('Потенциально опасное регулярное выражение с вложенными квантификаторами');
  return value;
}

export function makeSearchRegex(query, { regex = false, caseSensitive = false, global = true } = {}) {
  const source = regex ? validateRegexPattern(query) : escapeRegExp(query);
  return new RegExp(source, `${global ? 'g' : ''}${caseSensitive ? '' : 'i'}u`);
}

export function findTextMatches(text, query, options = {}) {
  if (!String(query || '')) return [];
  const source = String(text ?? '');
  const re = makeSearchRegex(query, { ...options, global: true });
  const matches = [];
  let match;
  while ((match = re.exec(source))) {
    matches.push({ startOffset: match.index, endOffset: match.index + match[0].length, text: match[0], groups: match.slice(1) });
    if (match[0] === '') re.lastIndex++;
  }
  return matches;
}

export function replaceTextMatches(text, query, replacement, options = {}) {
  const source = String(text ?? '');
  const re = makeSearchRegex(query, { ...options, global: true });
  return source.replace(re, String(replacement ?? ''));
}

export function extractReviewRouteSceneIds(route) {
  const candidates = [route?.sceneIds, route?.scenes, route?.path, route?.sequence, route?.route];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.map(item => typeof item === 'string' ? item : item?.sceneId || item?.id).filter(Boolean).map(String);
  }
  return [];
}
