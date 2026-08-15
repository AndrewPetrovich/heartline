import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportService } from '../hl-editor/application/import-service.js';

const projectId = '11111111-1111-4111-8111-111111111111';

class MemoryRepo {
  constructor() { this.projects = new Map(); this.snapshots = []; this.restored = null; }
  async projectExists(id) { return this.projects.has(id); }
  async importTransportAsNew(value) { this.projects.set(value.projectId, value); return value; }
  async getBinding() { return null; }
  async createSafetySnapshot(id, reason) { this.snapshots.push({ id, reason }); }
  async restoreProjectPackage(value) { this.restored = value; this.projects.set(value.projectId, value.project); }
}

class FakeZip {
  constructor() { this.entries = [
    { name: 'project.json', compressedSize: 10, uncompressedSize: 100 },
    { name: 'novel.json', compressedSize: 10, uncompressedSize: 100 },
    { name: 'metadata.json', compressedSize: 10, uncompressedSize: 100 }
  ]; }
  list() { return this.entries; }
  async read(entry) {
    const values = {
      'project.json': { schema: 'heartline-project-v4', project: { projectId, title: 'Novel', activeVersionId: `${projectId}::v1` }, activeVersionId: `${projectId}::v1` },
      'novel.json': { title: 'Novel', startScene: 'S1', scenes: [{ id: 'S1', steps: [] }] },
      'metadata.json': { project: { projectId, title: 'Novel', activeVersionId: `${projectId}::v1` }, versions: [{ versionId: `${projectId}::v1`, projectId, title: 'v1', content: { title: 'Novel', startScene: 'S1', scenes: [{ id: 'S1', steps: [] }] } }] }
    };
    return new TextEncoder().encode(JSON.stringify(values[entry.name]));
  }
}

function parser() {
  return {
    MiniZip: FakeZip,
    normalizeNovel: value => structuredClone(value),
    validateNovel: value => ({ ok: true, errors: [], warnings: [], stats: { scenes: value.scenes.length, fragments: 0 }, novel: structuredClone(value) }),
    importFiles: async () => ({ novel: { title: 'Imported', startScene: 'S1', scenes: [{ id: 'S1', steps: [{ type: 'narration', text: 'x' }] }] }, report: { format: 'DOCX', scenes: 1, fragments: 1 } })
  };
}

test('transport import explicitly creates a UUID project', async () => {
  const repo = new MemoryRepo();
  let count = 0;
  const ids = [projectId, '22222222-2222-4222-8222-222222222222'];
  const service = new ImportService({ contextRepository: repo, projectService: {}, parser: parser(), uuid: () => ids[count++], clock: () => '2026-08-15T00:00:00Z', policies: { archive: { maxEntries: 10, maxCompressedBytes: 1000, maxUncompressedBytes: 1000, maxEntryUncompressedBytes: 1000, maxCompressionRatio: 100 } } });
  const preview = await service.previewTransport([{}]);
  assert.equal(preview.projectId, '22222222-2222-4222-8222-222222222222');
  await service.commitTransport(preview);
  assert.equal(repo.projects.size, 1);
});

test('Project ZIP restore preserves existing projectId instead of creating a copy', async () => {
  const repo = new MemoryRepo();
  repo.projects.set(projectId, { projectId });
  const service = new ImportService({ contextRepository: repo, projectService: {}, parser: parser(), uuid: () => '33333333-3333-4333-8333-333333333333', clock: () => '2026-08-15T00:00:00Z', policies: { archive: { maxEntries: 10, maxCompressedBytes: 1000, maxUncompressedBytes: 1000, maxEntryUncompressedBytes: 1000, maxCompressionRatio: 100 } } });
  const file = { arrayBuffer: async () => new ArrayBuffer(1) };
  const preview = await service.previewProjectZip(file);
  assert.equal(preview.projectId, projectId);
  assert.equal(preview.kind, 'restore-existing');
  await service.commitProjectZip(preview);
  assert.equal(repo.snapshots.length, 1);
  assert.equal(repo.restored.projectId, projectId);
});
