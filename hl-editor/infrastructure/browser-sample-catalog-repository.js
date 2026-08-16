import { assertSampleCatalogRepository } from '../ports/sample-catalog-repository.js';

export class BrowserSampleCatalogRepository {
  constructor(url) { this.url = url; }
  async list() {
    const response = await fetch(this.url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Sample catalog unavailable: ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.samples)) throw new Error('Invalid HEARTLINE sample catalog');
    return payload.samples.map(item => ({ ...item, aliases: Array.isArray(item.aliases) ? item.aliases : [] }));
  }
}
