export const SAVE_STATES = Object.freeze(['saved', 'dirty', 'saving', 'error', 'conflict']);
export const REVIEW_STATES = Object.freeze(['not-started', 'in-progress', 'reviewed', 'approved']);

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function createProjectContext({ projectId, title, documentId, sourcePath, sourceHash, now }) {
  if (!isUuid(projectId)) throw new Error('New HL Editor projects require a UUID projectId');
  if (!isUuid(documentId)) throw new Error('HL Editor documents require a UUID documentId');
  return {
    formatVersion: 1,
    projectId,
    title: String(title || 'Untitled project'),
    documents: [{ documentId, relativePath: sourcePath, sourceHash }],
    review: { status: 'not-started', reviewedHash: null, reviewedAt: null },
    createdAt: now,
    updatedAt: now
  };
}

export function normalizeProjectContext(value) {
  if (!value || typeof value !== 'object') return null;
  if (!value.projectId) return null;
  return {
    formatVersion: Number(value.formatVersion || 1),
    projectId: String(value.projectId),
    title: String(value.title || 'Untitled project'),
    documents: Array.isArray(value.documents) ? value.documents.map(item => ({
      documentId: String(item.documentId || ''),
      relativePath: String(item.relativePath || ''),
      sourceHash: item.sourceHash ? String(item.sourceHash) : null
    })).filter(item => item.documentId && item.relativePath) : [],
    review: normalizeReview(value.review),
    createdAt: value.createdAt || null,
    updatedAt: value.updatedAt || null
  };
}

export function normalizeReview(review = {}) {
  const status = REVIEW_STATES.includes(review.status) ? review.status : 'not-started';
  return {
    status,
    reviewedHash: review.reviewedHash || null,
    reviewedAt: review.reviewedAt || null
  };
}

export function reviewStateForCurrentHash(review, currentHash) {
  const normalized = normalizeReview(review);
  if (!normalized.reviewedHash || normalized.reviewedHash !== currentHash) {
    return { ...normalized, status: normalized.status === 'not-started' ? 'not-started' : 'in-progress' };
  }
  return normalized;
}

export function markReviewed(currentHash, at, approved = false) {
  return { status: approved ? 'approved' : 'reviewed', reviewedHash: currentHash, reviewedAt: at };
}

export function classifySourceChange({ expectedHash, actualHash, previousPath, currentPath }) {
  if (!expectedHash) return 'new';
  if (!actualHash) return 'deleted';
  if (expectedHash === actualHash && previousPath === currentPath) return 'unchanged';
  if (expectedHash === actualHash && previousPath !== currentPath) return 'moved';
  return 'modified';
}

export function ensureStableFragmentIds(novel, uuid, { replaceGenerated = false } = {}) {
  if (!novel || typeof novel !== 'object') throw new Error('Novel content is required');
  const seen = new Set();
  const generatedPattern = /^FR_[A-Za-z0-9_-]+(?:_\d{3})+(?:_\d{3})*$/;
  const walk = steps => {
    for (const step of steps || []) {
      const current = String(step.fragmentId || '');
      const shouldReplace = !current || seen.has(current) || (replaceGenerated && generatedPattern.test(current));
      if (shouldReplace) step.fragmentId = `fr:${uuid()}`;
      seen.add(step.fragmentId);
      if (step.type === 'choice') for (const option of step.options || []) walk(option.steps || []);
    }
  };
  for (const scene of novel.scenes || []) walk(scene.steps || []);
  return novel;
}

export function makeRevisionName(at, hash) {
  const stamp = String(at).replace(/[:.]/g, '-');
  return `${stamp}-${String(hash || 'unknown').slice(0, 16)}.json`;
}

export function makeRecoveryName(at, documentId, kind = 'save') {
  const stamp = String(at).replace(/[:.]/g, '-');
  return `${stamp}-${kind}-${String(documentId || 'document').replace(/[^A-Za-z0-9:_-]/g, '_')}.json`;
}
