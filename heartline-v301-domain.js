export const TEXT_STATUSES = ['draft', 'needs-review', 'approved'];
export const VISUAL_STATUSES = ['missing', 'draft', 'needs-review', 'approved', 'rejected'];
export const REVIEW_STATUSES = ['Открыто', 'Передано GPT', 'GPT исправил', 'Требует проверки', 'Принято', 'Отклонено', 'Архив'];
export const CLOSED_REVIEW_STATUSES = new Set(['Принято', 'Отклонено', 'Архив']);

export function now() { return new Date().toISOString(); }
export function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
export function uid(prefix = 'id') { return `${prefix}:${crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`; }
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
export function slug(value) {
  return String(value || 'project').normalize('NFKD').replace(/[^A-Za-z0-9А-Яа-яЁё_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project';
}
export function formatDate(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch (_) { return String(value); }
}
export function plural(value, one, few, many) {
  const n = Math.abs(Number(value)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

export function parser() {
  if (!window.HEARTLINEParser) throw new Error('Parser HEARTLINE не загружен');
  return window.HEARTLINEParser;
}

export function normalizeNovel(content) { return parser().normalizeNovel(content); }
export function flattenFrames(content) {
  return parser().flattenFragments(content).filter(fragment => fragment.type !== 'tech');
}
export function getFrameRef(content, fragmentId) { return parser().getFragmentRef(content, fragmentId); }
export function chapterGroups(content) { return parser().getChapterGroups(content); }
export function validateNovel(content) { return parser().validateNovel(content); }

export function sourceText(step) {
  return step?.type === 'choice' ? (step.prompt || '') : (step?.text || '');
}

export function effectiveText(step, workspace) {
  const edited = workspace?.textEdits?.[step.fragmentId];
  return edited !== undefined ? edited : sourceText(step);
}

export function applyTextEditsToContent(content, textEdits = {}) {
  const copy = clone(content);
  function walk(steps) {
    for (const step of steps || []) {
      if (Object.prototype.hasOwnProperty.call(textEdits, step.fragmentId)) {
        if (step.type === 'choice') step.prompt = textEdits[step.fragmentId];
        else if (step.type !== 'tech') step.text = textEdits[step.fragmentId];
      }
      if (step.type === 'choice') for (const option of step.options || []) walk(option.steps || []);
    }
  }
  for (const scene of copy.scenes || []) walk(scene.steps || []);
  return copy;
}

export function sceneCue(scene) {
  const tech = (scene?.steps || []).find(step => step.type === 'tech' && (step.command === 'CG' || step.command === 'BG'));
  return tech?.value || '';
}

export function sceneVisualPrompt(scene, frame) {
  const steps = scene?.steps || [];
  const frameIndex = steps.findIndex(step => step.fragmentId === frame?.fragmentId);
  let prompt = '';
  for (let i = Math.max(0, frameIndex); i >= 0; i--) {
    const step = steps[i];
    if (step?.type === 'tech' && (step.command === 'CG' || step.command === 'BG')) { prompt = step.value || ''; break; }
  }
  return prompt || sceneCue(scene) || scene?.title || '';
}

export function frameModel(content, fragmentId, workspace, assignment, asset = null, reviews = []) {
  const ref = getFrameRef(content, fragmentId);
  if (!ref) return null;
  const step = ref.step;
  return {
    fragmentId,
    sceneId: ref.scene.id,
    sceneTitle: ref.scene.title,
    chapterId: ref.scene.chapterId,
    chapterTitle: ref.scene.chapterTitle,
    type: step.type,
    speaker: step.speaker || '',
    text: effectiveText(step, workspace),
    originalText: sourceText(step),
    options: step.type === 'choice' ? (step.options || []).map(option => ({ id: option.id, label: option.label })) : [],
    visualPrompt: sceneVisualPrompt(ref.scene, step),
    assignment,
    asset,
    reviews
  };
}

export function assignmentDefaults(projectId, scopeId, fragmentId) {
  return {
    assignmentId: `va:${scopeId}:${fragmentId}`,
    projectId,
    scopeId,
    fragmentId,
    assetId: null,
    fit: 'cover',
    focalPoint: { x: 0.5, y: 0.5 },
    zoom: 1,
    overlayOpacity: 0.12,
    status: 'missing',
    deviceOverrides: {},
    updatedAt: now()
  };
}

export function visualForDevice(assignment, deviceId) {
  const override = assignment?.deviceOverrides?.[deviceId] || {};
  return {
    fit: override.fit || assignment?.fit || 'cover',
    focalPoint: override.focalPoint || assignment?.focalPoint || { x: 0.5, y: 0.5 },
    zoom: Number(override.zoom || assignment?.zoom || 1),
    overlayOpacity: Number(override.overlayOpacity ?? assignment?.overlayOpacity ?? 0.12)
  };
}

export function invalidateApprovedVisual(assignment) {
  if (!assignment) return assignment;
  return { ...assignment, status: assignment.status === 'approved' ? 'needs-review' : assignment.status, invalidatedAt: now(), updatedAt: now() };
}

export function projectMetrics(content, workspace, assignments, reviews) {
  const frames = flattenFrames(content);
  const byFragment = new Map(assignments.map(item => [item.fragmentId, item]));
  const openReviews = reviews.filter(review => !CLOSED_REVIEW_STATUSES.has(review.status));
  const textEdited = Object.keys(workspace?.textEdits || {}).length;
  let assigned = 0, approved = 0, needsReview = 0, missing = 0;
  for (const frame of frames) {
    const assignment = byFragment.get(frame.fragmentId);
    if (!assignment?.assetId) missing++;
    else assigned++;
    if (assignment?.status === 'approved') approved++;
    if (assignment?.status === 'needs-review') needsReview++;
  }
  return {
    frames: frames.length,
    textEdited,
    assigned,
    approved,
    needsReview,
    missing,
    openReviews: openReviews.length,
    assignedPercent: frames.length ? Math.round(assigned / frames.length * 100) : 0,
    approvedPercent: frames.length ? Math.round(approved / frames.length * 100) : 0
  };
}

export function sceneFrameMetrics(content, sceneId, assignments, reviews) {
  const scene = (content.scenes || []).find(item => item.id === sceneId);
  if (!scene) return { frames: 0, missing: 0, needsReview: 0, approved: 0, reviews: 0 };
  const frames = [];
  (function walk(steps) {
    for (const step of steps || []) {
      if (step.type !== 'tech') frames.push(step.fragmentId);
      if (step.type === 'choice') for (const option of step.options || []) walk(option.steps || []);
    }
  })(scene.steps || []);
  const ids = new Set(frames);
  const relevant = assignments.filter(item => ids.has(item.fragmentId));
  return {
    frames: frames.length,
    missing: frames.filter(id => !relevant.find(item => item.fragmentId === id)?.assetId).length,
    needsReview: relevant.filter(item => item.status === 'needs-review').length,
    approved: relevant.filter(item => item.status === 'approved').length,
    reviews: reviews.filter(review => ids.has(review.fragmentId) && !CLOSED_REVIEW_STATUSES.has(review.status)).length
  };
}

export function frameDiagnostics(frame, device, visualSettings, textScale = 1) {
  const width = device.width;
  const height = device.height;
  const fontSize = Math.max(14, Math.round((device.fontSize || 17) * textScale));
  const approximateCharsPerLine = Math.max(18, Math.floor((width - 48) / (fontSize * 0.52)));
  const text = frame?.text || '';
  const lines = Math.max(1, Math.ceil(text.length / approximateCharsPerLine));
  const speakerLines = frame?.speaker ? 1 : 0;
  const optionLines = frame?.options?.length ? frame.options.reduce((sum, option) => sum + Math.max(1, Math.ceil(option.label.length / approximateCharsPerLine)), 0) : 0;
  const lineHeight = fontSize * 1.42;
  const panelHeight = 40 + (lines + speakerLines + optionLines) * lineHeight + (optionLines ? frame.options.length * 12 : 0);
  const ratio = panelHeight / height;
  const safeBottom = device.safeBottom || 20;
  const warnings = [];
  if (!frame?.assignment?.assetId) warnings.push({ code: 'missing-visual', level: 'error', text: 'Изображение не назначено.' });
  if (frame?.asset && (frame.asset.width < width * 2 || frame.asset.height < height * 1.2)) warnings.push({ code: 'low-resolution', level: 'warning', text: 'Разрешение изображения может быть недостаточным для этого устройства.' });
  if (lines > 8) warnings.push({ code: 'many-lines', level: 'warning', text: `Текст занимает около ${lines} строк. Рассмотрите разделение реплики.` });
  if (ratio > 0.45) warnings.push({ code: 'panel-ratio', level: 'error', text: `Текстовая панель занимает около ${Math.round(ratio * 100)}% экрана.` });
  else if (ratio > 0.34) warnings.push({ code: 'panel-ratio', level: 'warning', text: `Текстовая панель занимает около ${Math.round(ratio * 100)}% экрана.` });
  const focalY = visualSettings?.focalPoint?.y ?? 0.5;
  const panelTop = 1 - ratio - safeBottom / height;
  if (focalY > panelTop) warnings.push({ code: 'focal-overlap', level: 'warning', text: 'Текстовая панель перекрывает focal point изображения.' });
  if (frame?.options?.length > 4) warnings.push({ code: 'many-options', level: 'warning', text: 'На экране больше четырёх вариантов выбора.' });
  return { lines, panelHeight: Math.round(panelHeight), ratio, warnings, ok: !warnings.some(item => item.level === 'error') };
}

export function recordHistory(workspace, event) {
  const next = clone(workspace);
  next.undoStack = [...(next.undoStack || []), { ...event, eventId: uid('history'), createdAt: now() }].slice(-100);
  next.redoStack = [];
  next.dirty = true;
  next.updatedAt = now();
  return next;
}

export function statusLabel(status) {
  return ({
    missing: 'Нет изображения', draft: 'Черновик', 'needs-review': 'Требует проверки', approved: 'Утверждено', rejected: 'Отклонено'
  })[status] || status;
}

export function textTypeLabel(type) {
  return ({ dialogue: 'Диалог', narration: 'Нарратив', thought: 'Мысль', choice: 'Выбор' })[type] || type;
}
