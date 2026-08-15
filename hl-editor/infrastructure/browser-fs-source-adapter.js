import { PROJECT_CONTEXT_FORMAT_VERSION } from '../config.js';

const CONTEXT_DIR = '.hl-editor';
const CONTEXT_FILE = 'context.json';

async function permission(handle, mode = 'readwrite') {
  if (!handle?.queryPermission) return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  if (!handle.requestPermission) return false;
  return (await handle.requestPermission({ mode })) === 'granted';
}

async function writeHandle(handle, data) {
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch (_) {}
    throw error;
  }
}

async function readJsonFile(handle) {
  const file = await handle.getFile();
  return JSON.parse(await file.text());
}

async function getDirectory(root, parts, { create = false } = {}) {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create });
  return current;
}

async function atomicWriteInDirectory(directory, name, data) {
  const tempName = `.${name}.hl-tmp-${crypto.randomUUID()}`;
  const temp = await directory.getFileHandle(tempName, { create: true });
  await writeHandle(temp, data);
  let moved = false;
  if (typeof temp.move === 'function') {
    try {
      await temp.move(name);
      moved = true;
    } catch (_) {
      moved = false;
    }
  }
  if (!moved) {
    const target = await directory.getFileHandle(name, { create: true });
    await writeHandle(target, data);
    try { await directory.removeEntry(tempName); } catch (_) {}
  }
  return directory.getFileHandle(name);
}

async function listNames(directory) {
  const names = [];
  for await (const [name] of directory.entries()) names.push(name);
  return names.sort();
}

export class BrowserFsSourceProjectAdapter {
  constructor({ policies, parser }) {
    this.policies = policies;
    this.parser = parser;
  }

  async connect(rootHandle) {
    if (!rootHandle || rootHandle.kind !== 'directory') throw new Error('Выберите папку исходного проекта');
    if (!(await permission(rootHandle, 'readwrite'))) throw new Error('HEARTLINE требуется доступ на чтение и запись в папку проекта');
    let sourceHandle = null;
    let sourcePath = null;
    for (const candidate of this.policies.sourceDocumentCandidates) {
      try {
        sourceHandle = await rootHandle.getFileHandle(candidate);
        sourcePath = candidate;
        break;
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
    }
    if (!sourceHandle) throw new Error(`В папке проекта не найден исходный файл: ${this.policies.sourceDocumentCandidates.join(', ')}`);
    return { adapter: 'browser-fs-json-v1', rootHandle, sourceHandle, sourcePath };
  }

  async ensureContextLayout(binding) {
    const context = await binding.rootHandle.getDirectoryHandle(CONTEXT_DIR, { create: true });
    await context.getDirectoryHandle('recovery', { create: true });
    await context.getDirectoryHandle('revisions', { create: true });
    await context.getDirectoryHandle('backups', { create: true });
    await context.getDirectoryHandle('assets', { create: true });
  }

  async readContext(binding) {
    try {
      const context = await binding.rootHandle.getDirectoryHandle(CONTEXT_DIR);
      return readJsonFile(await context.getFileHandle(CONTEXT_FILE));
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async writeContext(binding, value) {
    const context = await binding.rootHandle.getDirectoryHandle(CONTEXT_DIR, { create: true });
    const payload = { ...value, formatVersion: Number(value.formatVersion || PROJECT_CONTEXT_FORMAT_VERSION) };
    await atomicWriteInDirectory(context, CONTEXT_FILE, JSON.stringify(payload, null, 2));
  }

  async readWorkspaceContext(binding) {
    try {
      const context = await binding.rootHandle.getDirectoryHandle(CONTEXT_DIR);
      const metadata = await readJsonFile(await context.getFileHandle('project-context.json'));
      const assetDir = await context.getDirectoryHandle('assets', { create: true });
      const assets = [];
      for (const asset of metadata.assets || []) {
        const ext = String(asset.mimeType || 'application/octet-stream').split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
        const safeId = String(asset.assetId || '').replace(/[^A-Za-z0-9:_-]/g, '_');
        try {
          const file = await (await assetDir.getFileHandle(`${safeId}.${ext}`)).getFile();
          assets.push({ ...asset, blob: file });
        } catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
          assets.push(asset);
        }
      }
      return { ...metadata, assets };
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async writeWorkspaceContext(binding, snapshot) {
    const context = await binding.rootHandle.getDirectoryHandle(CONTEXT_DIR, { create: true });
    const assetDir = await context.getDirectoryHandle('assets', { create: true });
    const assets = Array.isArray(snapshot.assets) ? snapshot.assets : [];
    for (const asset of assets) {
      if (!asset.blob) continue;
      const ext = String(asset.mimeType || asset.blob.type || 'application/octet-stream').split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
      const safeId = String(asset.assetId || crypto.randomUUID()).replace(/[^A-Za-z0-9:_-]/g, '_');
      const filename = `${safeId}.${ext}`;
      let needsWrite = true;
      try {
        const current = await (await assetDir.getFileHandle(filename)).getFile();
        needsWrite = current.size !== asset.blob.size;
      } catch (error) { if (error?.name !== 'NotFoundError') throw error; }
      if (needsWrite) await writeHandle(await assetDir.getFileHandle(filename, { create: true }), asset.blob);
    }
    const metadata = { ...snapshot, formatVersion: Number(snapshot.formatVersion || 1), assets: assets.map(({ blob, ...asset }) => asset) };
    await atomicWriteInDirectory(context, 'project-context.json', JSON.stringify(metadata, null, 2));
  }

  async readDocument(binding) {
    if (!(await permission(binding.rootHandle, 'readwrite'))) throw new Error('Доступ к исходному проекту потерян. Подключите папку повторно.');
    const sourceHandle = await binding.rootHandle.getFileHandle(binding.sourcePath || 'novel.json');
    binding.sourceHandle = sourceHandle;
    const file = await sourceHandle.getFile();
    const text = await file.text();
    const raw = JSON.parse(text);
    const content = this.parser.normalizeNovel(raw);
    return { relativePath: binding.sourcePath || file.name, text, content, title: content.title, lastModified: file.lastModified };
  }

  async writeDocumentAtomic(binding, text) {
    const sourcePath = binding.sourcePath || 'novel.json';
    binding.sourceHandle = await atomicWriteInDirectory(binding.rootHandle, sourcePath, text);
  }

  async writeRecovery(binding, name, payload) {
    const directory = await getDirectory(binding.rootHandle, [CONTEXT_DIR, 'recovery'], { create: true });
    await atomicWriteInDirectory(directory, name, JSON.stringify({ formatVersion: 1, status: 'pending', ...payload }, null, 2));
  }

  async markRecoveryCommitted(binding, name, patch) {
    const directory = await getDirectory(binding.rootHandle, [CONTEXT_DIR, 'recovery'], { create: true });
    try {
      const handle = await directory.getFileHandle(name);
      const payload = await readJsonFile(handle);
      await atomicWriteInDirectory(directory, name, JSON.stringify({ ...payload, ...patch, status: 'committed' }, null, 2));
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }

  async writeRevision(binding, name, text) {
    const directory = await getDirectory(binding.rootHandle, [CONTEXT_DIR, 'revisions'], { create: true });
    await atomicWriteInDirectory(directory, name, text);
  }

  async writeBackup(binding, backupId, payload) {
    const backups = await getDirectory(binding.rootHandle, [CONTEXT_DIR, 'backups'], { create: true });
    const directory = await backups.getDirectoryHandle(backupId, { create: true });
    await atomicWriteInDirectory(directory, 'source.json', payload.sourceText);
    const metadata = { ...payload.metadata };
    const assets = Array.isArray(metadata.assets) ? metadata.assets : [];
    metadata.assets = assets.map(({ blob, ...asset }) => asset);
    await atomicWriteInDirectory(directory, 'backup.json', JSON.stringify({ formatVersion: 1, ...payload, sourceText: undefined, metadata }, null, 2));
    if (assets.length) {
      const assetDir = await directory.getDirectoryHandle('assets', { create: true });
      for (const asset of assets) {
        if (!asset.blob) continue;
        const ext = String(asset.mimeType || asset.blob.type || 'application/octet-stream').split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
        const safeId = String(asset.assetId || crypto.randomUUID()).replace(/[^A-Za-z0-9:_-]/g, '_');
        const handle = await assetDir.getFileHandle(`${safeId}.${ext}`, { create: true });
        await writeHandle(handle, asset.blob);
      }
    }
  }

  async pruneRevisions(binding, retention) {
    const directory = await getDirectory(binding.rootHandle, [CONTEXT_DIR, 'revisions'], { create: true });
    const names = await listNames(directory);
    for (const name of names.slice(0, Math.max(0, names.length - retention))) await directory.removeEntry(name, { recursive: true });
  }

  async pruneBackups(binding, retention) {
    const directory = await getDirectory(binding.rootHandle, [CONTEXT_DIR, 'backups'], { create: true });
    const names = await listNames(directory);
    for (const name of names.slice(0, Math.max(0, names.length - retention))) await directory.removeEntry(name, { recursive: true });
  }
}
