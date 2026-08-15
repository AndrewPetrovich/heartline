export function assertProofreadingRepository(repository) {
  const methods = [
    'getMostRecentProject', 'getProjectBundle', 'saveProofreadingState', 'applyTextChanges',
    'putReview', 'getReview', 'updateReview', 'putChangeEvents', 'setWorkspaceSelection'
  ];
  for (const method of methods) if (!repository || typeof repository[method] !== 'function') throw new TypeError(`ProofreadingRepository.${method} is required`);
  return repository;
}
