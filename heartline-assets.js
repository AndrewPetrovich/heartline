import * as DB from './heartline-db.js';
import { now, uid, assignmentDefaults } from './heartline-domain.js';

const urlCache = new Map();

const workerRequests = new Map();
let imageWorker = null;
function getImageWorker() {
  if (!('Worker' in window)) return null;
  if (imageWorker) return imageWorker;
  try {
    imageWorker = new Worker('./heartline-image-worker.js');
    imageWorker.onmessage = event => { const req = workerRequests.get(event.data?.id); if (!req) return; workerRequests.delete(event.data.id); event.data.ok ? req.resolve(event.data) : req.reject(new Error(event.data.error || 'Image worker failed')); };
    imageWorker.onerror = error => { for (const req of workerRequests.values()) req.reject(error); workerRequests.clear(); imageWorker?.terminate(); imageWorker = null; };
    return imageWorker;
  } catch (_) { return null; }
}
async function processImageOffMainThread(file) {
  const worker = getImageWorker(); if (!worker) return null;
  const id = `img:${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => { workerRequests.set(id, { resolve, reject }); worker.postMessage({ id, buffer, mimeType: file.type }, [buffer]); });
}

function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

export async function sha256(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return bytesToHex(digest);
}

async function imageInfo(blob) {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob);
    const info = { width: bitmap.width, height: bitmap.height, bitmap };
    return info;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight, bitmap: image };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function makeThumbnail(blob, maxSide = 420) {
  const { width, height, bitmap } = await imageInfo(blob);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  if (bitmap.close) bitmap.close();
  const thumbnail = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
  return { blob: thumbnail || blob, width, height, thumbWidth: targetWidth, thumbHeight: targetHeight };
}

export async function importAsset(projectId, file, { source = 'upload' } = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error(`${file?.name || 'Файл'} не является изображением`);
  let processed = null;
  try { processed = await processImageOffMainThread(file); } catch (_) { processed = null; }
  const hash = processed?.hash || await sha256(file);
  const sameHash = await DB.getAllByIndex('assets', 'sha256', hash);
  const existing = sameHash.find(asset => asset.projectId === projectId);
  if (existing) return { asset: existing, duplicate: true };
  const generated = processed?.width ? { width: processed.width, height: processed.height, thumbWidth: processed.thumbWidth || processed.width, thumbHeight: processed.thumbHeight || processed.height, blob: processed.thumbBuffer ? new Blob([processed.thumbBuffer], { type: processed.thumbType || 'image/webp' }) : file } : await makeThumbnail(file);
  const legacyAssetId = `asset:${hash.slice(0, 20)}`;
  const legacyCollision = await DB.get('assets', legacyAssetId);
  let projectHash = 2166136261;
  for (const char of String(projectId || 'project')) { projectHash ^= char.charCodeAt(0); projectHash = Math.imul(projectHash, 16777619); }
  const projectPrefix = (projectHash >>> 0).toString(36);
  const assetId = legacyCollision && legacyCollision.projectId !== projectId
    ? `asset:${projectPrefix}:${hash.slice(0, 20)}`
    : legacyAssetId;
  const asset = {
    assetId,
    projectId,
    name: file.name || assetId,
    mimeType: file.type || 'application/octet-stream',
    width: generated.width,
    height: generated.height,
    fileSize: file.size,
    sha256: hash,
    source,
    blob: file,
    createdAt: now(),
    updatedAt: now()
  };
  await DB.put('assets', asset);
  await DB.put('assetThumbnails', {
    assetId,
    projectId,
    blob: generated.blob,
    width: generated.thumbWidth,
    height: generated.thumbHeight,
    createdAt: now()
  });
  return { asset, duplicate: false };
}

export async function importAssets(projectId, files, { matchFrames = [], scopeId = null } = {}) {
  const results = [];
  const frameMap = new Map(matchFrames.map(frame => [frame.fragmentId.toLowerCase(), frame.fragmentId]));
  for (const file of Array.from(files || [])) {
    if (!file.type.startsWith('image/')) continue;
    const result = await importAsset(projectId, file);
    const base = file.name.replace(/\.[^.]+$/, '').toLowerCase();
    const matched = [...frameMap.entries()].find(([key]) => base === key || base.startsWith(`${key}_`) || base.startsWith(`${key}-`));
    if (matched && scopeId) {
      await assignAsset(projectId, scopeId, matched[1], result.asset.assetId, { status: 'draft' });
      result.matchedFragmentId = matched[1];
    }
    results.push(result);
  }
  return results;
}

export async function assignAsset(projectId, scopeId, fragmentId, assetId, patch = {}) {
  const id = DB.visualAssignmentId(scopeId, fragmentId);
  const current = await DB.get('visualAssignments', id) || assignmentDefaults(projectId, scopeId, fragmentId);
  const assignment = {
    ...current,
    ...patch,
    assetId,
    status: patch.status || (assetId ? (current.status === 'approved' ? 'needs-review' : 'draft') : 'missing'),
    updatedAt: now()
  };
  await DB.put('visualAssignments', assignment);
  return assignment;
}

export async function updateAssignment(projectId, scopeId, fragmentId, patch) {
  const id = DB.visualAssignmentId(scopeId, fragmentId);
  const current = await DB.get('visualAssignments', id) || assignmentDefaults(projectId, scopeId, fragmentId);
  const assignment = { ...current, ...patch, updatedAt: now() };
  await DB.put('visualAssignments', assignment);
  return assignment;
}

export async function removeAssignmentAsset(projectId, scopeId, fragmentId) {
  return updateAssignment(projectId, scopeId, fragmentId, { assetId: null, status: 'missing' });
}

export async function copyPreviousAssignment(projectId, scopeId, previousFragmentId, fragmentId) {
  const previous = await DB.get('visualAssignments', DB.visualAssignmentId(scopeId, previousFragmentId));
  if (!previous?.assetId) throw new Error('У предыдущего кадра нет изображения');
  return updateAssignment(projectId, scopeId, fragmentId, {
    assetId: previous.assetId,
    fit: previous.fit,
    focalPoint: { ...previous.focalPoint },
    zoom: previous.zoom,
    overlayOpacity: previous.overlayOpacity,
    deviceOverrides: structuredClone(previous.deviceOverrides || {}),
    status: 'draft'
  });
}

export async function assetUsage(projectId, assetId) {
  const assignments = await DB.getAllByIndex('visualAssignments', 'assetId', assetId);
  const frameUsage = assignments.filter(item => item.projectId === projectId).length;
  const project = await DB.get('projects', projectId);
  return frameUsage + (project?.coverAssetId === assetId ? 1 : 0);
}

export async function deleteAsset(projectId, assetId, { force = false } = {}) {
  const assignments = await DB.getAllByIndex('visualAssignments', 'assetId', assetId);
  const frameUsage = assignments.filter(item => item.projectId === projectId).length;
  const project = await DB.get('projects', projectId);
  const isCover = project?.coverAssetId === assetId;
  const usage = frameUsage + (isCover ? 1 : 0);
  if (usage && !force) throw new Error(`Изображение используется: ${frameUsage} кадров${isCover ? ' и обложка проекта' : ''}`);
  if (force) {
    for (const assignment of assignments.filter(item => item.projectId === projectId)) {
      await DB.put('visualAssignments', { ...assignment, assetId: null, status: 'missing', updatedAt: now() });
    }
    if (isCover) {
      project.coverAssetId = null;
      project.updatedAt = now();
      await DB.put('projects', project);
    }
  }
  await DB.del('assets', assetId);
  await DB.del('assetThumbnails', assetId);
  revokeAssetUrl(assetId);
}

export async function assetObjectUrl(assetId, { thumbnail = false } = {}) {
  if (!assetId) return null;
  const key = `${thumbnail ? 'thumb' : 'asset'}:${assetId}`;
  if (urlCache.has(key)) return urlCache.get(key);
  const record = await DB.get(thumbnail ? 'assetThumbnails' : 'assets', assetId);
  if (!record?.blob) return null;
  const url = URL.createObjectURL(record.blob);
  urlCache.set(key, url);
  return url;
}

export function revokeAssetUrl(assetId) {
  for (const key of [`asset:${assetId}`, `thumb:${assetId}`]) {
    const url = urlCache.get(key);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(key);
  }
}

export function revokeAllAssetUrls() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

export async function imageFilesFromZip(file) {
  const parser = window.HEARTLINEParser;
  const zip = new parser.MiniZip(await file.arrayBuffer());
  const entries = zip.list().filter(entry => /\.(png|jpe?g|webp|avif)$/i.test(entry.name) && !entry.name.endsWith('/'));
  const files = [];
  for (const entry of entries) {
    const bytes = await zip.read(entry);
    const extension = entry.name.split('.').pop().toLowerCase();
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' })[extension] || 'application/octet-stream';
    files.push(new File([bytes], entry.name.split('/').pop(), { type: mime }));
  }
  return files;
}

export async function assetBlob(assetId) {
  return (await DB.get('assets', assetId))?.blob || null;
}
