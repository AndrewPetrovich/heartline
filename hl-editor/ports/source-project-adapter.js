export class SourceConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SourceConflictError';
    this.code = 'SOURCE_CONFLICT';
    this.details = details;
  }
}

export class SourceWriteError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'SourceWriteError';
    this.code = 'SOURCE_WRITE_FAILED';
    this.cause = cause;
  }
}

export function assertSourceProjectAdapter(adapter) {
  const required = [
    'connect', 'ensureContextLayout', 'readContext', 'writeContext', 'readWorkspaceContext', 'writeWorkspaceContext', 'readDocument',
    'writeDocumentAtomic', 'writeRecovery', 'markRecoveryCommitted', 'writeRevision',
    'writeBackup', 'pruneRevisions', 'pruneBackups'
  ];
  for (const method of required) if (typeof adapter?.[method] !== 'function') throw new TypeError(`SourceProjectAdapter.${method} is required`);
  return adapter;
}
