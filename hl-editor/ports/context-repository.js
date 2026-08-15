export function assertContextRepository(repository) {
  const required = [
    'getProject', 'getWorkspace', 'getBinding', 'attachSourceProject', 'saveBinding',
    'setWorkspaceState', 'commitWorkspaceSave', 'updateWorkingCache', 'createRevisionCache',
    'saveRecoveryMetadata', 'markRecoveryCommitted', 'createSafetySnapshot', 'getProjectSnapshot', 'markReviewState', 'restoreContextCheckpoint', 'getLatestRevision', 'pruneRevisionCache'
  ];
  for (const method of required) if (typeof repository?.[method] !== 'function') throw new TypeError(`ProjectContextRepository.${method} is required`);
  return repository;
}
