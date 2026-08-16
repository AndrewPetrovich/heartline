export function assertEditorialWorkflowRepository(repository) {
  const required = ['getProjectBundle', 'saveEditorialState', 'setWorkspaceSelection'];
  for (const method of required) {
    if (typeof repository?.[method] !== 'function') throw new TypeError(`EditorialWorkflowRepository.${method} is required`);
  }
  return repository;
}
