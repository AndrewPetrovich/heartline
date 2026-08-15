import * as DB from '../../heartline-db.js';
import * as Domain from '../../heartline-domain.js';
import { mergePolicies } from '../config.js';
import { BrowserHashService } from '../infrastructure/browser-hash-service.js';
import { BrowserFsSourceProjectAdapter } from '../infrastructure/browser-fs-source-adapter.js';
import { BrowserProjectContextRepository } from '../infrastructure/browser-context-repository.js';
import { ProjectService } from '../application/project-service.js';
import { ImportService } from '../application/import-service.js';
import { SourceConflictError } from '../ports/source-project-adapter.js';

const parser = window.HEARTLINEParser;
const policies = mergePolicies();
const contextRepository = new BrowserProjectContextRepository();
const sourceAdapter = new BrowserFsSourceProjectAdapter({ policies, parser });
const projectService = new ProjectService({
  sourceAdapter,
  contextRepository,
  hashService: new BrowserHashService(),
  uuid: () => crypto.randomUUID(),
  clock: () => new Date().toISOString(),
  policies
});
const importService = new ImportService({
  contextRepository, projectService, parser,
  uuid: () => crypto.randomUUID(),
  clock: () => new Date().toISOString(),
  policies
});

const saveTimers = new Map();
const saveLocks = new Map();
const checkpointTimers = new Map();
let banner = null;
let editorAutosaveTimer = null;

function ensureBanner() {
  if (banner?.isConnected) return banner;
  banner = document.createElement('div');
  banner.id = 'hlProjectCoreBanner';
  banner.className = 'hl-project-core-banner hidden';
  banner.innerHTML = '<strong></strong><span></span><button type="button" aria-label="Закрыть">×</button>';
  banner.querySelector('button').onclick = () => banner.classList.add('hidden');
  document.body.appendChild(banner);
  return banner;
}

function notify(kind, title, message, persistent = false) {
  const node = ensureBanner();
  node.dataset.kind = kind;
  node.querySelector('strong').textContent = title;
  node.querySelector('span').textContent = message;
  node.classList.remove('hidden');
  if (!persistent) setTimeout(() => node.classList.add('hidden'), 4500);
}

function logTechnical(label, error) {
  console.error(`[HEARTLINE:${label}]`, error?.name || 'Error', error?.message || String(error));
}

async function effectiveProjectContent(projectId) {
  const [project, workspace] = await Promise.all([DB.get('projects', projectId), DB.get('workspaceDrafts', projectId)]);
  if (!project || !workspace) return null;
  const version = await DB.get('versions', project.activeVersionId);
  if (!version?.content) return null;
  return { project, workspace, content: Domain.applyTextEditsToContent(version.content, workspace.textEdits || {}) };
}

async function flushSourceSave(projectId, reason = 'autosave') {
  if (saveLocks.has(projectId)) return saveLocks.get(projectId);
  const task = (async () => {
    const binding = await DB.get('sourceBindings', projectId);
    if (!binding) return { status: 'detached' };
    const current = await effectiveProjectContent(projectId);
    if (!current) return { status: 'missing-context' };
    const result = await projectService.saveDocument({ projectId, content: current.content, reason });
    if (result.status === 'saved') notify('saved', 'Исходный проект сохранён', `Source hash ${result.sourceHash.slice(0, 12)}…`);
    return result;
  })().catch(error => {
    if (error instanceof SourceConflictError || error?.code === 'SOURCE_CONFLICT') {
      notify('conflict', 'Конфликт исходного проекта', 'Файл изменён вне HEARTLINE. Перезапись отменена; рабочий текст сохранён в recovery.', true);
    } else {
      notify('error', 'Ошибка сохранения', 'Исходник не перезаписан. Рабочая версия сохранена в recovery.', true);
    }
    logTechnical('save', error);
    return { status: error?.code === 'SOURCE_CONFLICT' ? 'conflict' : 'error', error };
  }).finally(() => saveLocks.delete(projectId));
  saveLocks.set(projectId, task);
  return task;
}

async function scheduleSourceSave(projectId, reason = 'autosave') {
  clearTimeout(saveTimers.get(projectId));
  const workspace = await DB.get('workspaceDrafts', projectId);
  if (!workspace?.dirty || !Object.keys(workspace.textEdits || {}).length) return;
  const binding = await DB.get('sourceBindings', projectId);
  if (!binding) return;
  saveTimers.set(projectId, setTimeout(() => flushSourceSave(projectId, reason), policies.autosaveDelayMs));
}

async function scheduleContextCheckpoint(projectId) {
  if (!projectId) return;
  clearTimeout(checkpointTimers.get(projectId));
  const binding = await DB.get('sourceBindings', projectId);
  if (!binding) return;
  checkpointTimers.set(projectId, setTimeout(() => {
    projectService.checkpointContext(projectId).catch(error => logTechnical('checkpoint', error));
  }, Math.max(1500, policies.autosaveDelayMs)));
}

async function activeProject() {
  return (await DB.getAll('projects')).sort((a, b) => String(b.lastOpenedAt || b.updatedAt || '').localeCompare(String(a.lastOpenedAt || a.updatedAt || '')))[0] || null;
}

async function activeSourceProject() {
  const project = await activeProject();
  return project?.sourceBacked ? project : null;
}

async function createManualRevisionForActiveProject() {
  const project = await activeSourceProject();
  if (!project) return false;
  const label = prompt('Название revision', `Revision ${new Date().toLocaleString('ru-RU')}`);
  if (!label) return true;
  const note = prompt('Комментарий к revision', '') || '';
  try {
    const result = await projectService.createManualRevision(project.projectId, { label, note });
    notify('saved', 'Revision создана', result.revisionName);
    setTimeout(() => location.reload(), 400);
  } catch (error) {
    notify('error', 'Revision не создана', error.message || String(error), true);
    logTechnical('revision', error);
  }
  return true;
}

async function restoreRevisionForActiveProject(versionId) {
  const project = await activeSourceProject();
  if (!project) return false;
  const version = await DB.get('versions', versionId);
  if (!version?.content) return true;
  if (!confirm(`Восстановить revision «${version.label || version.versionId}» в исходный проект?\n\nПеред восстановлением будет создан backup и safety revision. projectId не изменится.`)) return true;
  try {
    const result = await projectService.restoreDocument({ projectId: project.projectId, content: version.content });
    notify('saved', 'Revision восстановлена', `Исходный проект обновлён; hash ${result.sourceHash.slice(0, 12)}…`);
    setTimeout(() => location.reload(), 500);
  } catch (error) {
    if (error?.code === 'SOURCE_CONFLICT') notify('conflict', 'Restore остановлен', 'Исходник изменён вне HEARTLINE; перезапись отменена.', true);
    else notify('error', 'Restore не выполнен', error.message || String(error), true);
    logTechnical('revision-restore', error);
  }
  return true;
}

async function connectSourceFolder() {
  if (!window.showDirectoryPicker) {
    notify('error', 'Папка проекта недоступна', 'Этот браузер не предоставляет File System Access API. Используйте актуальный Chromium/Edge или desktop-host HEARTLINE.', true);
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'heartline-source-project' });
    notify('saving', 'Подключаю исходный проект', 'Проверяю source hash и .hl-editor context…', true);
    const result = await projectService.connectSourceProject(handle);
    if (result.status === 'conflict') {
      notify('conflict', 'Найден конфликт', 'Внешняя версия и локальный dirty workspace расходятся. Данные сохранены в recovery.', true);
      return;
    }
    notify('saved', 'Проект подключён', 'projectId сохранён в .hl-editor/context.json. Открываю постоянный workspace…');
    setTimeout(() => location.reload(), 500);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    notify('error', 'Не удалось подключить проект', error.message || String(error), true);
    logTechnical('connect', error);
  }
}

async function importTransportAsNew(files) {
  try {
    const preview = await importService.previewTransport(files);
    const stats = preview.validation?.stats || preview.report || {};
    if (!confirm(`Импортировать «${preview.title}» как новый проект?\n\nСцен: ${stats.scenes ?? '—'}\nФрагментов: ${stats.fragments ?? '—'}\nprojectId: ${preview.projectId}\n\nЭто транспортный импорт. Для постоянного source-backed проекта используйте «Подключить папку проекта».`)) return;
    await importService.commitTransport(preview);
    notify('saved', 'Импорт завершён', 'Создан новый UUID-проект. Обычный повторный импорт больше не используется как обновление проекта.');
    setTimeout(() => location.reload(), 450);
  } catch (error) {
    notify('error', 'Импорт отклонён', error.message || String(error), true);
    logTechnical('import', error);
  }
}

async function restoreProjectZip(file) {
  try {
    const preview = await importService.previewProjectZip(file);
    const action = preview.exists ? 'восстановить существующий проект с тем же projectId' : 'восстановить проект';
    if (!confirm(`Готово к восстановлению: ${action}.\n\nprojectId: ${preview.projectId}\nВерсий: ${preview.versionCount}\nИзображений: ${preview.assetCount}\n\nПеред заменой существующего состояния будет создан safety snapshot${preview.sourceBound ? ' и backup в .hl-editor/backups' : ''}.`)) return;
    const result = await importService.commitProjectZip(preview);
    notify('saved', 'Восстановление завершено', `projectId сохранён: ${result.projectId}`);
    setTimeout(() => location.reload(), 500);
  } catch (error) {
    if (error?.code === 'SOURCE_CONFLICT') notify('conflict', 'Restore остановлен', 'Исходник изменён снаружи. HEARTLINE не стал молча его перезаписывать.', true);
    else notify('error', 'Restore не выполнен', error.message || String(error), true);
    logTechnical('restore', error);
  }
}

async function createBackupForActiveProject() {
  const project = await activeSourceProject();
  if (!project) return notify('error', 'Backup недоступен', 'Сначала подключите source-backed проект.', true);
  try {
    const result = await projectService.createBackup(project.projectId);
    notify('saved', 'Backup создан', `${result.backupId} в .hl-editor/backups`);
  } catch (error) {
    notify('error', 'Backup не создан', error.message || String(error), true);
    logTechnical('backup', error);
  }
}

async function markActiveReviewed(approved = false) {
  const project = await activeSourceProject();
  if (!project) return notify('error', 'Статус вычитки недоступен', 'Сначала подключите исходный проект.', true);
  try {
    const review = await projectService.markProjectReviewed(project.projectId, { approved });
    notify('saved', approved ? 'Текст утверждён' : 'Текст вычитан', `Статус привязан к source hash ${review.reviewedHash.slice(0, 12)}…`);
  } catch (error) {
    notify('error', 'Статус не сохранён', error.message || String(error), true);
  }
}

function enhanceLibrary() {
  const header = document.querySelector('.library-page .header-actions');
  if (!header || document.getElementById('connectSourceProjectButton')) return;
  const button = document.createElement('button');
  button.id = 'connectSourceProjectButton';
  button.className = 'button primary';
  button.textContent = 'Подключить папку проекта';
  header.prepend(button);
  button.onclick = connectSourceFolder;
  const importButton = document.getElementById('importNovelButton');
  if (importButton) {
    importButton.textContent = 'Импортировать как новый';
    importButton.title = 'Создаёт новый проект. Для продолжения работы с существующим используйте подключение папки.';
  }
  const note = document.querySelector('.library-sync-note strong');
  const noteText = document.querySelector('.library-sync-note p');
  if (note) note.textContent = 'Source-backed проекты сохраняются непосредственно в исходную папку.';
  if (noteText) noteText.textContent = 'HEARTLINE context хранится в .hl-editor/. Legacy/transport проекты остаются в браузере, пока не подключены к исходной папке.';
}

function enhanceExport() {
  if (!document.getElementById('exportProject')) return;
  const grid = document.querySelector('.export-grid');
  if (!grid || document.getElementById('hlCreateBackup')) return;
  const card = document.createElement('article');
  card.className = 'card export-card';
  card.innerHTML = '<h2>Source safety</h2><p>Backup исходника + HL context, а также hash-bound статус вычитки.</p><button id="hlCreateBackup" class="button primary">Создать backup</button><button id="hlMarkReviewed" class="button secondary">Текст вычитан</button><button id="hlMarkApproved" class="button secondary">Утвердить текст</button>';
  grid.appendChild(card);
  card.querySelector('#hlCreateBackup').onclick = createBackupForActiveProject;
  card.querySelector('#hlMarkReviewed').onclick = () => markActiveReviewed(false);
  card.querySelector('#hlMarkApproved').onclick = () => markActiveReviewed(true);
}

async function surfaceRecovery() {
  const pending = (await DB.getAll('recovery')).filter(item => item.status === 'pending');
  if (pending.length) notify('conflict', 'Обнаружены recovery-данные', `${pending.length} незавершённых сохранений/конфликтов доступны в .hl-editor/recovery и локальном контексте.`, true);
}

function installStyles() {
  const style = document.createElement('style');
  style.textContent = `
.hl-project-core-banner{position:fixed;z-index:10000;left:50%;top:12px;transform:translateX(-50%);max-width:min(760px,calc(100vw - 24px));display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(0,0,0,.14);border-radius:12px;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.18);font:13px/1.35 system-ui,sans-serif;color:#171717}.hl-project-core-banner.hidden{display:none}.hl-project-core-banner strong{white-space:nowrap}.hl-project-core-banner button{border:0;background:transparent;font-size:20px;cursor:pointer}.hl-project-core-banner[data-kind="conflict"],.hl-project-core-banner[data-kind="error"]{border-color:#b34a4a;background:#fff7f7}.hl-project-core-banner[data-kind="saved"]{border-color:#4d8663;background:#f5fff8}@media(max-width:640px){.hl-project-core-banner{grid-template-columns:1fr auto}.hl-project-core-banner span{grid-column:1/-1;grid-row:2}.hl-project-core-banner strong{white-space:normal}}
`;
  document.head.appendChild(style);
}

window.addEventListener('heartline:db-write', event => {
  const detail = event.detail || {};
  if (detail.storeName === 'workspaceDrafts' && detail.key) scheduleSourceSave(detail.key).catch(error => logTechnical('autosave-schedule', error));
  const projectId = detail.projectId || (detail.storeName === 'projects' ? detail.key : null) || (detail.storeName === 'projectContext' ? detail.key : null);
  if (projectId && !['sourceBindings', 'recovery', 'safetySnapshots'].includes(detail.storeName)) scheduleContextCheckpoint(projectId).catch(error => logTechnical('checkpoint-schedule', error));
});

// Separate capture handler resolves source-backed status synchronously from the rendered project route marker.
// We keep a small cache updated by navigation/project writes so legacy detached projects retain their old behaviour.
let cachedSourceBackedProjectId = null;
async function refreshSourceBackedCache() { cachedSourceBackedProjectId = (await activeSourceProject())?.projectId || null; }
window.addEventListener('heartline:db-write', () => refreshSourceBackedCache().catch(() => {}));
setTimeout(() => refreshSourceBackedCache().catch(() => {}), 0);

document.addEventListener('click', event => {
  const createVersion = event.target?.closest?.('#createVersion');
  const openVersion = event.target?.closest?.('[data-open-version]');
  if (!cachedSourceBackedProjectId || (!createVersion && !openVersion)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (createVersion) createManualRevisionForActiveProject();
  else restoreRevisionForActiveProject(openVersion.dataset.openVersion);
}, true);

document.addEventListener('change', event => {
  if (event.target?.id === 'novelInput' && event.target.files?.length) {
    event.preventDefault(); event.stopImmediatePropagation();
    importTransportAsNew(Array.from(event.target.files));
  } else if (event.target?.id === 'projectImportInput' && event.target.files?.[0]) {
    event.preventDefault(); event.stopImmediatePropagation();
    restoreProjectZip(event.target.files[0]);
  }
}, true);

document.addEventListener('input', event => {
  if (event.target?.id !== 'frameTextEditor' || !cachedSourceBackedProjectId) return;
  clearTimeout(editorAutosaveTimer);
  editorAutosaveTimer = setTimeout(() => document.getElementById('saveFrameText')?.click(), Math.max(1800, policies.autosaveDelayMs));
}, true);

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    const editor = document.getElementById('frameTextEditor');
    if (editor && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      document.getElementById('saveFrameText')?.click();
    }
  }
}, true);

const observer = new MutationObserver(() => { enhanceLibrary(); enhanceExport(); });
observer.observe(document.documentElement, { childList: true, subtree: true });

installStyles();
ensureBanner();
setTimeout(() => { enhanceLibrary(); enhanceExport(); surfaceRecovery().catch(error => logTechnical('recovery', error)); }, 0);

window.HEARTLINEProjectCore = Object.freeze({ projectService, importService, connectSourceFolder, flushSourceSave, createBackupForActiveProject });
