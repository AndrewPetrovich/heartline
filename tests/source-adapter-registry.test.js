import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceAdapterRegistry } from '../hl-editor/application/source-adapter-registry.js';
import { HEARTLINE_JSON_SOURCE_POLICY } from '../hl-editor/infrastructure/source-adapters/heartline-json-source-policy.js';

test('source adapter registry keeps format-specific source rules out of project config', () => {
  const registry = new SourceAdapterRegistry();
  const adapter = { id: 'fake' };
  registry.register('fake', adapter, { isDefault: true });
  assert.equal(registry.defaultAdapter(), adapter);
  assert.deepEqual(HEARTLINE_JSON_SOURCE_POLICY.sourceDocumentCandidates, ['novel.json']);
});
