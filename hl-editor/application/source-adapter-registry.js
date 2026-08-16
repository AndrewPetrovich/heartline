export class SourceAdapterRegistry {
  constructor() { this.adapters = new Map(); this.defaultId = null; }
  register(id, adapter, { isDefault = false } = {}) {
    if (!id || !adapter) throw new TypeError('Source adapter id and instance are required');
    this.adapters.set(id, adapter);
    if (isDefault || !this.defaultId) this.defaultId = id;
    return adapter;
  }
  get(id) { return this.adapters.get(id) || null; }
  defaultAdapter() {
    const adapter = this.get(this.defaultId);
    if (!adapter) throw new Error('No SourceProjectAdapter is registered');
    return adapter;
  }
  list() { return [...this.adapters.entries()].map(([id, adapter]) => ({ id, adapter })); }
}
