import { assertSourceProjectAdapter, SourceConflictError, SourceWriteError } from '../ports/source-project-adapter.js';
import { assertContextRepository } from '../ports/context-repository.js';
import {
  createProjectContext, normalizeProjectContext, reviewStateForCurrentHash,
  makeRevisionName, makeRecoveryName, markReviewed, classifySourceChange
} from '../domain/project.js';

export class ProjectService {
  constructor({ sourceAdapter, contextRepository, hashService, uuid, clock, policies }) {
    this.sourceAdapter = assertSourceProjectAdapter(sourceAdapter);
    this.contextRepository = assertContextRepository(contextRepository);
    this.hashService = hashService;
    this.uuid = uuid;
    this.clock = clock;
    this.policies = policies;
  }

  async connectSourceProject(rootHandle) {
    const binding = await this.sourceAdapter.connect(rootHandle);
    await this.sourceAdapter.ensureContextLayout(binding);
    const source = await this.sourceAdapter.readDocument(binding);
    const sourceHash = await this.hashService.sha256Text(source.text);
    const stored = normalizeProjectContext(await this.sourceAdapter.readContext(binding));
    const now = this.clock();
    const projectId = stored?.projectId || this.uuid();
    const knownDocuments = stored?.documents || [];
    const existingDocument = knownDocuments.find(item => item.relativePath === source.relativePath) || (knownDocuments.length === 1 ? knownDocuments[0] : null);
    const documentId = existingDocument?.documentId || this.uuid();
    let existingProject = await this.contextRepository.getProject(projectId);
    if (!existingProject) {
      const checkpoint = await this.sourceAdapter.readWorkspaceContext(binding);
      if (checkpoint?.project?.projectId === projectId) {
        await this.contextRepository.restoreContextCheckpoint(checkpoint);
        existingProject = await this.contextRepository.getProject(projectId);
      }
    }
    const existingWorkspace = existingProject ? await this.contextRepository.getWorkspace(projectId) : null;
    const existingBinding = existingProject ? await this.contextRepository.getBinding(projectId) : null;

    if (existingBinding?.sourceHash && existingBinding.sourceHash !== sourceHash && existingWorkspace?.dirty) {
      const recoveryName = makeRecoveryName(now, documentId, 'external-conflict');
      await this.sourceAdapter.writeRecovery(binding, recoveryName, {
        projectId, documentId, expectedHash: existingBinding.sourceHash, actualHash: sourceHash,
        workspace: existingWorkspace, reason: 'external-source-changed-before-reconnect', createdAt: now
      });
      await this.contextRepository.saveRecoveryMetadata({
        recoveryId: recoveryName, projectId, documentId, status: 'pending', reason: 'external-conflict', createdAt: now
      });
      await this.contextRepository.setWorkspaceState(projectId, { saveState: 'conflict', conflict: { expectedHash: existingBinding.sourceHash, actualHash: sourceHash }, updatedAt: now });
      return { status: 'conflict', projectId, documentId, expectedHash: existingBinding.sourceHash, actualHash: sourceHash };
    }

    const context = stored || createProjectContext({
      projectId, title: source.title || existingProject?.title || 'HEARTLINE project', documentId,
      sourcePath: source.relativePath, sourceHash, now
    });
    context.title = source.title || context.title;
    context.updatedAt = now;
    const doc = context.documents.find(item => item.documentId === documentId) || context.documents[0];
    if (doc) { doc.relativePath = source.relativePath; doc.sourceHash = sourceHash; }
    context.review = reviewStateForCurrentHash(context.review, sourceHash);
    await this.sourceAdapter.writeContext(binding, context);

    const persistedBinding = {
      projectId, documentId, sourcePath: source.relativePath, sourceHash,
      rootHandle: binding.rootHandle, sourceHandle: binding.sourceHandle,
      adapter: binding.adapter, attachedAt: existingBinding?.attachedAt || now, updatedAt: now
    };
    await this.contextRepository.attachSourceProject({
      projectId, documentId, title: context.title, content: source.content, sourceHash,
      binding: persistedBinding, existing: Boolean(existingProject), review: context.review, now
    });
    await this.checkpointContext(projectId);
    return { status: existingProject ? 'reconnected' : 'connected', projectId, documentId, sourceHash, content: source.content };
  }

  async saveDocument({ projectId, content, reason = 'autosave' }) {
    const binding = await this.contextRepository.getBinding(projectId);
    if (!binding) return { status: 'detached', projectId };
    const project = await this.contextRepository.getProject(projectId);
    const workspace = await this.contextRepository.getWorkspace(projectId);
    if (!project || !workspace) throw new Error('Project context is incomplete');
    const now = this.clock();
    const serialized = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const desiredHash = await this.hashService.sha256Text(serialized);
    const source = await this.sourceAdapter.readDocument(binding);
    const actualHash = await this.hashService.sha256Text(source.text);
    const expectedHash = binding.sourceHash;

    if (expectedHash && actualHash !== expectedHash) {
      const recoveryId = makeRecoveryName(now, binding.documentId, 'conflict');
      await this.sourceAdapter.writeRecovery(binding, recoveryId, {
        projectId, documentId: binding.documentId, reason: 'external-conflict',
        expectedHash, actualHash, desiredHash, content: serialized, createdAt: now
      });
      await this.contextRepository.saveRecoveryMetadata({ recoveryId, projectId, documentId: binding.documentId, status: 'pending', reason: 'external-conflict', createdAt: now });
      await this.contextRepository.setWorkspaceState(projectId, { saveState: 'conflict', conflict: { expectedHash, actualHash }, updatedAt: now });
      throw new SourceConflictError('Исходный проект изменён вне HEARTLINE. Автоперезапись отменена.', { projectId, expectedHash, actualHash, recoveryId });
    }

    if (actualHash === desiredHash) {
      await this.contextRepository.commitWorkspaceSave(projectId, { sourceHash: desiredHash, content: source.content, savedAt: now });
      return { status: 'saved', projectId, sourceHash: desiredHash, unchanged: true };
    }

    const revisionName = makeRevisionName(now, actualHash);
    const recoveryId = makeRecoveryName(now, binding.documentId, reason);
    const latestRevision = await this.contextRepository.getLatestRevision(projectId);
    const latestAt = latestRevision?.createdAt ? Date.parse(latestRevision.createdAt) : 0;
    const nowMs = Date.parse(now);
    const shouldCreateRevision = reason !== 'autosave' || !latestRevision || !Number.isFinite(nowMs - latestAt) || (nowMs - latestAt) >= this.policies.revisionMinIntervalMs;
    if (shouldCreateRevision) {
      await this.sourceAdapter.writeRevision(binding, revisionName, source.text);
      await this.contextRepository.createRevisionCache(projectId, { revisionId: revisionName, sourceHash: actualHash, content: source.content, createdAt: now, reason });
    }
    await this.sourceAdapter.writeRecovery(binding, recoveryId, {
      projectId, documentId: binding.documentId, reason: 'pre-save', expectedHash, actualHash,
      desiredHash, content: serialized, createdAt: now
    });
    await this.contextRepository.saveRecoveryMetadata({ recoveryId, projectId, documentId: binding.documentId, status: 'pending', reason: 'pre-save', createdAt: now });
    await this.contextRepository.setWorkspaceState(projectId, { saveState: 'saving', updatedAt: now });

    try {
      await this.sourceAdapter.writeDocumentAtomic(binding, serialized);
      const verified = await this.sourceAdapter.readDocument(binding);
      const verifiedHash = await this.hashService.sha256Text(verified.text);
      if (verifiedHash !== desiredHash) throw new Error('Source verification hash does not match saved content');
      const nextBinding = { ...binding, sourceHash: verifiedHash, updatedAt: this.clock() };
      await this.contextRepository.saveBinding(nextBinding);
      await this.contextRepository.updateWorkingCache(projectId, { content: verified.content, sourceHash: verifiedHash, updatedAt: this.clock() });
      await this.contextRepository.commitWorkspaceSave(projectId, { sourceHash: verifiedHash, content: verified.content, savedAt: this.clock() });
      const manifest = normalizeProjectContext(await this.sourceAdapter.readContext(binding));
      if (manifest) {
        const document = manifest.documents.find(item => item.documentId === binding.documentId) || manifest.documents.find(item => item.relativePath === binding.sourcePath);
        if (document) document.sourceHash = verifiedHash;
        manifest.review = reviewStateForCurrentHash(manifest.review, verifiedHash);
        manifest.updatedAt = this.clock();
        await this.sourceAdapter.writeContext(binding, manifest);
      }
      await this.sourceAdapter.markRecoveryCommitted(binding, recoveryId, { committedAt: this.clock(), sourceHash: verifiedHash });
      await this.contextRepository.markRecoveryCommitted(recoveryId, { committedAt: this.clock(), sourceHash: verifiedHash });
      await this.sourceAdapter.pruneRevisions(binding, this.policies.revisionRetention);
      await this.contextRepository.pruneRevisionCache(projectId, this.policies.revisionRetention);
      await this.checkpointContext(projectId);
      return { status: 'saved', projectId, sourceHash: verifiedHash, revisionName, recoveryId };
    } catch (error) {
      await this.contextRepository.setWorkspaceState(projectId, { saveState: 'error', error: String(error?.message || error), updatedAt: this.clock() });
      throw new SourceWriteError('Не удалось сохранить исходный проект. Рабочая версия оставлена в recovery.', error);
    }
  }

  async scanProject(projectId) {
    const binding = await this.contextRepository.getBinding(projectId);
    if (!binding) return [{ state: 'deleted', documentId: null, relativePath: null }];
    try {
      const source = await this.sourceAdapter.readDocument(binding);
      const actualHash = await this.hashService.sha256Text(source.text);
      return [{
        documentId: binding.documentId, relativePath: source.relativePath, actualHash, expectedHash: binding.sourceHash,
        state: classifySourceChange({ expectedHash: binding.sourceHash, actualHash, previousPath: binding.sourcePath, currentPath: source.relativePath })
      }];
    } catch (error) {
      if (error?.name === 'NotFoundError') return [{ documentId: binding.documentId, relativePath: binding.sourcePath, state: 'deleted' }];
      throw error;
    }
  }

  async markProjectReviewed(projectId, { approved = false } = {}) {
    const binding = await this.contextRepository.getBinding(projectId);
    const project = await this.contextRepository.getProject(projectId);
    const currentHash = binding?.sourceHash || project?.sourceHash;
    if (!project || !currentHash) throw new Error('Нельзя отметить вычитку без сохранённого source hash');
    const review = markReviewed(currentHash, this.clock(), approved);
    await this.contextRepository.markReviewState(projectId, review);
    if (binding) {
      const manifest = normalizeProjectContext(await this.sourceAdapter.readContext(binding));
      if (manifest) { manifest.review = review; manifest.updatedAt = this.clock(); await this.sourceAdapter.writeContext(binding, manifest); }
      await this.checkpointContext(projectId);
    }
    return review;
  }

  async checkpointContext(projectId) {
    const binding = await this.contextRepository.getBinding(projectId);
    if (!binding) return { status: 'detached' };
    const snapshot = await this.contextRepository.getProjectSnapshot(projectId);
    await this.sourceAdapter.writeWorkspaceContext(binding, snapshot);
    return { status: 'checkpointed', projectId };
  }

  async createManualRevision(projectId, { label = 'Manual revision', note = '' } = {}) {
    const binding = await this.contextRepository.getBinding(projectId);
    if (!binding) return { status: 'detached' };
    const source = await this.sourceAdapter.readDocument(binding);
    const sourceHash = await this.hashService.sha256Text(source.text);
    const at = this.clock();
    const revisionName = makeRevisionName(at, sourceHash);
    await this.sourceAdapter.writeRevision(binding, revisionName, source.text);
    const versionId = await this.contextRepository.createRevisionCache(projectId, { revisionId: revisionName, sourceHash, content: source.content, createdAt: at, reason: note || label, label });
    await this.sourceAdapter.pruneRevisions(binding, this.policies.revisionRetention);
    await this.contextRepository.pruneRevisionCache(projectId, this.policies.revisionRetention);
    await this.checkpointContext(projectId);
    return { status: 'created', versionId, revisionName, sourceHash };
  }

  async createBackup(projectId, label = 'manual') {
    const binding = await this.contextRepository.getBinding(projectId);
    if (!binding) return { status: 'detached' };
    const source = await this.sourceAdapter.readDocument(binding);
    const snapshot = await this.contextRepository.getProjectSnapshot(projectId);
    const stamp = this.clock();
    const backupId = `${String(stamp).replace(/[:.]/g, '-')}-${label}`;
    await this.sourceAdapter.writeBackup(binding, backupId, { sourceText: source.text, metadata: snapshot, createdAt: stamp, label });
    await this.sourceAdapter.pruneBackups(binding, this.policies.backupRetention);
    return { status: 'created', backupId };
  }

  async restoreDocument({ projectId, content, allowExternalOverwrite = false }) {
    const binding = await this.contextRepository.getBinding(projectId);
    if (!binding) return { status: 'detached' };
    await this.createBackup(projectId, 'pre-restore');
    const source = await this.sourceAdapter.readDocument(binding);
    const actualHash = await this.hashService.sha256Text(source.text);
    if (!allowExternalOverwrite && binding.sourceHash && actualHash !== binding.sourceHash) {
      await this.contextRepository.setWorkspaceState(projectId, { saveState: 'conflict', conflict: { expectedHash: binding.sourceHash, actualHash }, updatedAt: this.clock() });
      throw new SourceConflictError('Восстановление остановлено: исходник был изменён вне HEARTLINE.', { expectedHash: binding.sourceHash, actualHash });
    }
    return this.saveDocument({ projectId, content, reason: 'restore' });
  }
}
