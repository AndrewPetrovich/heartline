import { assertSampleCatalogRepository } from '../ports/sample-catalog-repository.js';

export class SampleCatalogService {
  constructor(repository) { this.repository = assertSampleCatalogRepository(repository); }
  list() { return this.repository.list(); }
}
