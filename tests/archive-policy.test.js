import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeArchivePath, validateArchiveEntries, UnsafeArchiveError } from '../hl-editor/domain/archive-policy.js';

const policy = { maxEntries: 10, maxCompressedBytes: 1000, maxUncompressedBytes: 5000, maxEntryUncompressedBytes: 3000, maxCompressionRatio: 20 };

test('archive policy rejects traversal and absolute paths', () => {
  assert.equal(isSafeArchivePath('assets/a.png'), true);
  assert.equal(isSafeArchivePath('../secret'), false);
  assert.equal(isSafeArchivePath('/absolute/file'), false);
  assert.throws(() => validateArchiveEntries([{ name: '../x', compressedSize: 1, uncompressedSize: 1 }], policy), UnsafeArchiveError);
});

test('archive policy rejects zip-bomb ratios and size limits', () => {
  assert.throws(() => validateArchiveEntries([{ name: 'x.bin', compressedSize: 1, uncompressedSize: 100 }], policy), /compression ratio/i);
  assert.throws(() => validateArchiveEntries([{ name: 'x.bin', compressedSize: 100, uncompressedSize: 4000 }], policy), /too large/i);
});
