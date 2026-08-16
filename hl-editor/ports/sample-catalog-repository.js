export function assertSampleCatalogRepository(repository) {
  if (typeof repository?.list !== 'function') throw new TypeError('SampleCatalogRepository.list is required');
  return repository;
}
