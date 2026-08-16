import test from 'node:test';
import assert from 'node:assert/strict';
import { frameDiagnostics } from '../heartline-domain.js';

const device = {
  width: 360, height: 640, fontSize: 16,
  safeTop: 44, safeRight: 0, safeBottom: 34, safeLeft: 0
};

test('diagnostics reports missing visual and preserves safe-area data', () => {
  const result = frameDiagnostics({ text: 'Короткий текст', options: [], assignment: {} }, device, { focalPoint: { x: .5, y: .5 } }, 1);
  assert.ok(result.warnings.some(item => item.code === 'missing-visual'));
  assert.equal(result.safeArea.top, 44);
  assert.equal(result.usableHeight, 562);
});

test('diagnostics warns about undersized text', () => {
  const result = frameDiagnostics({ text: 'Текст', options: [], assignment: { assetId: 'asset' } }, device, { focalPoint: { x: .5, y: .2 } }, .8);
  assert.ok(result.warnings.some(item => item.code === 'min-text-size'));
});

test('diagnostics evaluates choice touch target', () => {
  const result = frameDiagnostics({
    text: 'Выберите вариант',
    options: [{ label: 'A' }, { label: 'B' }],
    assignment: { assetId: 'asset' }
  }, { ...device, fontSize: 12 }, { focalPoint: { x: .5, y: .2 } }, 1);
  assert.ok(result.warnings.some(item => item.code === 'touch-target'));
});
