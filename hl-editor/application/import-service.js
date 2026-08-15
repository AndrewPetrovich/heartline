import { ensureStableFragmentIds, isUuid } from '../domain/project.js';
import { validateArchiveEntries } from '../domain/archive-policy.js';

const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

export class ImportService {
  constructor({ contextRepository, projectService, parser, uuid, clock, policies }) {
    this.contextRepository = contextRepository;
    this.projectService = projectService;
    this.parser = parser;
    this.uuid = uuid;
    this.clock = clock;
    this.policies = policies;
  }

  async previewTransport(files) {
    const imported = await this.parser.importFiles(files);
    const content = clone(imported.novel);
    ensureStableFragmentIds(content, this.uuid, { replaceGenerated: imported.report.format !== 'JSON' });
    const validation = this.parser.validateNovel(content);
    if (!validation.ok) {
      const error = new Error(`Импорт содержит ${validation.errors.length} ошибок структуры`);
      error.validation = validation;
      throw error;
    }
    return {
      kind: 'import-as-new',
      projectId: this.uuid(),
      title: content.title,
      content: validation.novel,
      validation,
      report: imported.report,
      sourceType: `transport-${String(imported.report.format || 'unknown').toLowerCase()}`
    };
  }

  async commitTransport(preview) {
    if (await this.contextRepository.projectExists(preview.projectId)) throw new Error('Generated projectId already exists');
    return this.contextRepository.importTransportAsNew({ ...preview, now: this.clock() });
  }

  async previewProjectZip(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const zip = new this.parser.MiniZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    validateArchiveEntries(zip.list(), this.policies.archive);
    const entry = pattern => zip.list().find(item => pattern.test(item.name));
    const projectEntry = entry(/(^|\/)project\.json$/i);
    const novelEntry = entry(/(^|\/)novel\.json$/i);
    const metadataEntry = entry(/(^|\/)metadata\.json$/i);
    const manifestEntry = entry(/(^|\/)visual-manifest\.json$/i);
    const reviewsEntry = entry(/(^|\/)reviews\.json$/i);
    if (!projectEntry || !novelEntry) throw new Error('Это не HEARTLINE Project ZIP');
    const decodeJson = async value => JSON.parse(new TextDecoder().decode(await zip.read(value)));
    const projectPayload = await decodeJson(projectEntry);
    const fallbackContent = this.parser.normalizeNovel(await decodeJson(novelEntry));
    const metadata = metadataEntry ? await decodeJson(metadataEntry) : null;
    const originalProject = metadata?.project || projectPayload.project || {};
    const projectId = String(originalProject.projectId || fallbackContent.id || this.uuid());
    const exists = await this.contextRepository.projectExists(projectId);
    const sourceBound = Boolean(await this.contextRepository.getBinding(projectId));
    const sourceVersions = metadata?.versions?.length ? metadata.versions : [{
      versionId: projectPayload.activeVersionId || `${projectId}::working`, projectId,
      label: 'Restored project', parentVersionId: null, sourceType: 'project-zip',
      createdAt: this.clock(), updatedAt: this.clock(), content: fallbackContent,
      validation: this.parser.validateNovel(fallbackContent)
    }];
    const versions = sourceVersions.map(version => ({ ...clone(version), projectId, content: this.parser.normalizeNovel(version.content || fallbackContent) }));
    const activeVersionId = metadata?.project?.activeVersionId || projectPayload.activeVersionId || versions.at(-1)?.versionId;
    const sourceAssignments = metadata?.assignments?.length ? metadata.assignments : manifestEntry ? await decodeJson(manifestEntry) : [];
    const sourceReviews = metadata?.reviews?.length ? metadata.reviews : reviewsEntry ? await decodeJson(reviewsEntry) : [];
    const assetMetadata = new Map((metadata?.assets || []).map(asset => [asset.assetId, asset]));
    const assetEntries = zip.list().filter(item => /^assets\//.test(item.name) && /\.(png|jpe?g|webp|avif)$/i.test(item.name));
    const assets = [];
    for (const assetEntry of assetEntries) {
      const raw = await zip.read(assetEntry);
      const filename = assetEntry.name.split('/').pop();
      const assetId = filename.replace(/\.[^.]+$/, '');
      const extension = filename.split('.').pop().toLowerCase();
      const mimeType = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' })[extension];
      const prior = assetMetadata.get(assetId) || {};
      assets.push({ ...clone(prior), assetId, projectId, mimeType, fileSize: raw.byteLength, blob: new Blob([raw], { type: mimeType }), updatedAt: prior.updatedAt || this.clock(), createdAt: prior.createdAt || this.clock() });
    }
    const workspace = metadata?.workspace ? { ...clone(metadata.workspace), projectId, undoStack: [], redoStack: [] } : {
      projectId, baseVersionId: activeVersionId, textEdits: {}, selectedFragmentId: null,
      selectedSceneId: fallbackContent.startScene, undoStack: [], redoStack: [], dirty: false, saveState: 'saved', updatedAt: this.clock()
    };
    const packageData = {
      projectId,
      project: { ...clone(originalProject), projectId, activeVersionId, title: originalProject.title || fallbackContent.title, formatVersion: 4, updatedAt: this.clock(), importedAt: this.clock() },
      versions,
      workspace,
      sessions: (metadata?.sessions || []).map(value => ({ ...clone(value), projectId })),
      reviews: (Array.isArray(sourceReviews) ? sourceReviews : []).map(value => ({ ...clone(value), projectId })),
      assignments: (Array.isArray(sourceAssignments) ? sourceAssignments : Object.values(sourceAssignments || {})).map(value => ({ ...clone(value), projectId })),
      assets,
      candidates: (metadata?.candidates || []).map(value => ({ ...clone(value), projectId })),
      cycles: (metadata?.cycles || []).map(value => ({ ...clone(value), projectId })),
      changeEvents: (metadata?.changeEvents || []).map(value => ({ ...clone(value), projectId }))
    };
    return { kind: exists ? 'restore-existing' : 'restore', projectId, exists, sourceBound, fallbackContent, packageData, assetCount: assets.length, versionCount: versions.length };
  }

  async commitProjectZip(preview) {
    if (preview.exists) await this.contextRepository.createSafetySnapshot(preview.projectId, 'pre-project-zip-restore');
    let sourceSave = null;
    if (preview.sourceBound) {
      await this.projectService.createBackup(preview.projectId, 'pre-project-zip-restore');
      sourceSave = await this.projectService.restoreDocument({ projectId: preview.projectId, content: preview.fallbackContent });
      const now = this.clock();
      const workingVersionId = `${preview.projectId}::working`;
      preview.packageData.project = {
        ...preview.packageData.project, activeVersionId: workingVersionId, sourceBacked: true, transportOnly: false,
        sourceHash: sourceSave.sourceHash, updatedAt: now
      };
      preview.packageData.versions = [
        ...preview.packageData.versions.filter(version => version.versionId !== workingVersionId),
        { versionId: workingVersionId, projectId: preview.projectId, label: 'Working source', sourceType: 'source-project-cache', cacheOnly: true, createdAt: now, updatedAt: now, content: clone(preview.fallbackContent), sourceHash: sourceSave.sourceHash }
      ];
      preview.packageData.workspace = {
        ...preview.packageData.workspace, baseVersionId: workingVersionId, textEdits: {}, dirty: false,
        saveState: 'saved', conflict: null, error: null, updatedAt: now
      };
    }
    await this.contextRepository.restoreProjectPackage(preview.packageData);
    if (preview.sourceBound) await this.projectService.checkpointContext(preview.projectId);
    return { status: preview.exists ? 'restored-existing' : 'restored', projectId: preview.projectId, sourceHash: sourceSave?.sourceHash || null };
  }
}
