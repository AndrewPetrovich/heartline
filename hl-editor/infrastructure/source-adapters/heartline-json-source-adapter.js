import { BrowserFsSourceProjectAdapter } from '../browser-fs-source-adapter.js';

export class HeartlineJsonSourceProjectAdapter extends BrowserFsSourceProjectAdapter {
  constructor({ policies, parser, sourcePolicy }) {
    super({ policies: { ...policies, sourceDocumentCandidates: [...sourcePolicy.sourceDocumentCandidates] }, parser });
    this.adapterId = sourcePolicy.adapterId;
  }

  async scan(binding, knownDocuments = []) {
    const source = await this.readDocument(binding);
    const known = knownDocuments.find(document => document.relativePath === source.relativePath)
      || (knownDocuments.length === 1 ? knownDocuments[0] : null);
    return [{
      documentId: known?.documentId || null,
      relativePath: source.relativePath,
      content: source.content,
      text: source.text,
      state: known ? (known.relativePath === source.relativePath ? 'candidate' : 'moved') : 'new'
    }];
  }

  async loadDocument(binding) { return this.readDocument(binding); }
  async saveDocumentAtomic(binding, text) { return this.writeDocumentAtomic(binding, text); }
  async loadMetadata(binding) { return this.readContext(binding); }
  async saveMetadata(binding, metadata) { return this.writeContext(binding, metadata); }
}
