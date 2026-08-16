import { reviewFingerprint } from '../../proofreading/domain/proofreading.js';

export const EDITORIAL_WORKFLOW_FORMAT_VERSION = 1;
export const EDITORIAL_STAGES = Object.freeze(['text', 'visual', 'final']);
export const FINAL_REVIEW_STATES = Object.freeze(['not-started', 'attention', 'changed', 'reviewed']);

const clone = value => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
}

export function visualSnapshot(assignment) {
  if (!assignment) return {
    assetId: null,
    fit: 'cover',
    focalPoint: { x: .5, y: .5 },
    zoom: 1,
    overlayOpacity: 0,
    deviceOverrides: {}
  };
  return {
    assetId: assignment.assetId || null,
    fit: assignment.fit || 'cover',
    focalPoint: {
      x: Number(assignment.focalPoint?.x ?? .5),
      y: Number(assignment.focalPoint?.y ?? .5)
    },
    zoom: Number(assignment.zoom ?? 1),
    overlayOpacity: Number(assignment.overlayOpacity ?? 0),
    deviceOverrides: stableObject(assignment.deviceOverrides || {})
  };
}

export function visualFingerprint(assignment) {
  return reviewFingerprint(JSON.stringify(stableObject(visualSnapshot(assignment))));
}

export function createDefaultEditorialWorkflowState(now = new Date().toISOString()) {
  return {
    formatVersion: EDITORIAL_WORKFLOW_FORMAT_VERSION,
    activeStage: 'text',
    finalUnits: {},
    finalTargetDeviceIds: [],
    updatedAt: now
  };
}

export function normalizeEditorialWorkflowState(value, now = new Date().toISOString()) {
  const base = createDefaultEditorialWorkflowState(now);
  if (!value || typeof value !== 'object') return base;
  const finalUnits = {};
  for (const [fragmentId, record] of Object.entries(value.finalUnits || {})) {
    if (!record?.textHash || !record?.visualHash) continue;
    finalUnits[fragmentId] = {
      textHash: String(record.textHash),
      visualHash: String(record.visualHash),
      reviewedAt: record.reviewedAt || null,
      updatedAt: record.updatedAt || record.reviewedAt || null
    };
  }
  return {
    formatVersion: EDITORIAL_WORKFLOW_FORMAT_VERSION,
    activeStage: EDITORIAL_STAGES.includes(value.activeStage) ? value.activeStage : 'text',
    finalUnits,
    finalTargetDeviceIds: Array.isArray(value.finalTargetDeviceIds)
      ? [...new Set(value.finalTargetDeviceIds.map(String).filter(Boolean))].slice(0, 8)
      : [],
    updatedAt: value.updatedAt || now
  };
}

export function deriveVisualState(assignment) {
  return assignment?.assetId
    ? { status: 'ready', ready: true }
    : { status: 'missing', ready: false };
}

export function deriveFinalReviewState({
  record = null,
  textHash,
  visualHash,
  textReady,
  visualReady,
  openReviewCount = 0,
  diagnostics = []
}) {
  const blockers = [];
  if (!textReady) blockers.push({ code: 'text-not-reviewed', level: 'warning', text: 'Текст ещё не подтверждён после последнего изменения.' });
  if (!visualReady) blockers.push({ code: 'missing-visual', level: 'error', text: 'Изображение не назначено.' });
  if (openReviewCount > 0) blockers.push({ code: 'open-reviews', level: 'warning', text: `Открытых замечаний: ${openReviewCount}.` });
  const diagnosticErrors = diagnostics.flatMap(item => item?.warnings || []).filter(item => item.level === 'error');
  if (diagnosticErrors.length) blockers.push({ code: 'preview-errors', level: 'error', text: `Preview: критических проблем ${diagnosticErrors.length}.` });

  if (record?.textHash && record?.visualHash && (record.textHash !== textHash || record.visualHash !== visualHash)) {
    return { status: 'changed', reviewed: false, blockers };
  }
  if (blockers.length) return { status: 'attention', reviewed: false, blockers };
  if (!record?.textHash || !record?.visualHash) return { status: 'not-started', reviewed: false, blockers: [] };
  return { status: 'reviewed', reviewed: true, blockers: [] };
}

export function markFinalReviewed(state, fragmentId, { textHash, visualHash, at }) {
  const next = normalizeEditorialWorkflowState(clone(state), at);
  next.finalUnits[fragmentId] = {
    textHash,
    visualHash,
    reviewedAt: at,
    updatedAt: at
  };
  next.updatedAt = at;
  return next;
}

export function setActiveEditorialStage(state, stage, at) {
  if (!EDITORIAL_STAGES.includes(stage)) throw new Error(`Unknown editorial stage: ${stage}`);
  const next = normalizeEditorialWorkflowState(clone(state), at);
  next.activeStage = stage;
  next.updatedAt = at;
  return next;
}

export function aggregateEditorialStages(units) {
  const total = units.length;
  const textCompleted = units.filter(unit => ['reviewed', 'approved'].includes(unit.textStatus)).length;
  const visualCompleted = units.filter(unit => unit.visualReady).length;
  const finalCompleted = units.filter(unit => unit.finalStatus === 'reviewed').length;
  const percent = value => total ? Math.round(value / total * 100) : 0;
  return {
    total,
    text: {
      completed: textCompleted,
      remaining: Math.max(0, total - textCompleted),
      percent: percent(textCompleted)
    },
    visual: {
      completed: visualCompleted,
      remaining: Math.max(0, total - visualCompleted),
      percent: percent(visualCompleted)
    },
    final: {
      completed: finalCompleted,
      remaining: Math.max(0, total - finalCompleted),
      percent: percent(finalCompleted),
      attention: units.filter(unit => unit.finalStatus === 'attention').length,
      changed: units.filter(unit => unit.finalStatus === 'changed').length
    }
  };
}

export function recommendedEditorialStage(stages) {
  if (Number(stages?.text?.percent || 0) < 100) return 'text';
  if (Number(stages?.visual?.percent || 0) < 100) return 'visual';
  return 'final';
}
