export class UnsafeArchiveError extends Error {
  constructor(message, code = 'UNSAFE_ARCHIVE') {
    super(message);
    this.name = 'UnsafeArchiveError';
    this.code = code;
  }
}

export function isSafeArchivePath(name) {
  const normalized = String(name || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some(part => part === '..');
}

export function validateArchiveEntries(entries, policy) {
  const list = Array.from(entries || []);
  if (list.length > policy.maxEntries) throw new UnsafeArchiveError(`Archive contains too many entries: ${list.length}`, 'ENTRY_LIMIT');
  let compressed = 0;
  let uncompressed = 0;
  for (const entry of list) {
    if (!isSafeArchivePath(entry.name)) throw new UnsafeArchiveError(`Unsafe archive path: ${entry.name}`, 'PATH_TRAVERSAL');
    const c = Number(entry.compressedSize || 0);
    const u = Number(entry.uncompressedSize || 0);
    compressed += c;
    uncompressed += u;
    if (u > policy.maxEntryUncompressedBytes) throw new UnsafeArchiveError(`Archive entry is too large: ${entry.name}`, 'ENTRY_SIZE');
    const ratio = c > 0 ? u / c : (u ? Infinity : 1);
    if (ratio > policy.maxCompressionRatio) throw new UnsafeArchiveError(`Suspicious compression ratio: ${entry.name}`, 'ZIP_BOMB_RATIO');
  }
  if (compressed > policy.maxCompressedBytes) throw new UnsafeArchiveError('Compressed archive is too large', 'COMPRESSED_SIZE');
  if (uncompressed > policy.maxUncompressedBytes) throw new UnsafeArchiveError('Uncompressed archive is too large', 'UNCOMPRESSED_SIZE');
  return { entries: list.length, compressedBytes: compressed, uncompressedBytes: uncompressed };
}
