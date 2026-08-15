export const PROJECT_CONTEXT_FORMAT_VERSION = 1;
export const DATABASE_FORMAT_VERSION = 4;

export const PROJECT_POLICIES = Object.freeze({
  autosaveDelayMs: 1200,
  revisionRetention: 50,
  revisionMinIntervalMs: 5 * 60 * 1000,
  backupRetention: 10,
  sourceDocumentCandidates: Object.freeze(['novel.json']),
  transportExtensions: Object.freeze(['.json', '.docx', '.zip']),
  archive: Object.freeze({
    maxEntries: 2000,
    maxCompressedBytes: 512 * 1024 * 1024,
    maxUncompressedBytes: 1024 * 1024 * 1024,
    maxEntryUncompressedBytes: 256 * 1024 * 1024,
    maxCompressionRatio: 200
  }),
  images: Object.freeze({
    maxFileBytes: 64 * 1024 * 1024,
    maxFilesPerImport: 1000,
    mimeTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/avif'])
  })
});

export function mergePolicies(overrides = {}) {
  return {
    ...PROJECT_POLICIES,
    ...overrides,
    archive: { ...PROJECT_POLICIES.archive, ...(overrides.archive || {}) },
    images: { ...PROJECT_POLICIES.images, ...(overrides.images || {}) }
  };
}
