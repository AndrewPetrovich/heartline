import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultProofreadingState, normalizeProofreadingState, deriveUnitState, markUnitReviewed,
  createTextAnchor, resolveTextAnchor, runDeterministicChecks, validateRegexPattern,
  findTextMatches, replaceTextMatches, aggregateStatuses, reviewFingerprint, analyzeNovelStyle
} from '../hl-editor/proofreading/domain/proofreading.js';

test('proofreading uses one continuous review state without passes', () => {
  const state = createDefaultProofreadingState('2026-08-15T00:00:00Z');
  assert.equal(state.formatVersion, 2);
  assert.equal('passes' in state, false);
  assert.deepEqual(state.units, {});
});

test('legacy pass-based proofreading state migrates to latest reviewed record', () => {
  const state = normalizeProofreadingState({
    formatVersion: 1,
    activePassId: 'style',
    passes: [{ id: 'read' }, { id: 'style' }],
    units: { f1: { passes: {
      read: { status: 'reviewed', reviewedHash: 'old', reviewedAt: '2026-08-14T00:00:00Z' },
      style: { status: 'reviewed', reviewedHash: 'new', reviewedAt: '2026-08-15T00:00:00Z' }
    } } }
  });
  assert.equal(state.units.f1.reviewedHash, 'new');
  assert.equal('passes' in state.units.f1, false);
});

test('granular review hash invalidates only the changed fragment', () => {
  let state = createDefaultProofreadingState('2026-08-15T00:00:00Z');
  state = markUnitReviewed(state, 'fr:a', 'Текст A', '2026-08-15T00:01:00Z');
  state = markUnitReviewed(state, 'fr:b', 'Текст B', '2026-08-15T00:01:00Z');
  assert.equal(deriveUnitState({ state, fragmentId: 'fr:a', currentText: 'Текст A', reviews: [] }).status, 'reviewed');
  assert.equal(deriveUnitState({ state, fragmentId: 'fr:b', currentText: 'Текст B!', reviews: [] }).status, 'changed');
  assert.equal(deriveUnitState({ state, fragmentId: 'fr:a', currentText: 'Текст A', reviews: [] }).status, 'reviewed');
});

test('open text review takes precedence over reviewed status', () => {
  let state = createDefaultProofreadingState('2026-08-15T00:00:00Z');
  state = markUnitReviewed(state, 'fr:a', 'Текст', '2026-08-15T00:01:00Z');
  const derived = deriveUnitState({ state, fragmentId: 'fr:a', currentText: 'Текст', reviews: [{ fragmentId: 'fr:a', targetType: 'text', status: 'Открыто' }] });
  assert.equal(derived.status, 'attention');
});

test('durable anchor relocates after text is inserted before it', () => {
  const original = 'Он посмотрел на окно и улыбнулся.';
  const start = original.indexOf('окно');
  const anchor = createTextAnchor({ text: original, startOffset: start, endOffset: start + 4 });
  const changed = 'Тихо. ' + original;
  const resolved = resolveTextAnchor(changed, anchor);
  assert.equal(resolved.status, 'relocated');
  assert.equal(changed.slice(resolved.startOffset, resolved.endOffset), 'окно');
});

test('deterministic checks find spacing, repeat, mixed scripts and dash', () => {
  const findings = runDeterministicChecks('Он  он Aлексей - пришёл , домой.');
  const codes = new Set(findings.map(item => item.code));
  assert.ok(codes.has('double-space'));
  assert.ok(codes.has('repeated-word'));
  assert.ok(codes.has('mixed-scripts'));
  assert.ok(codes.has('dash-style'));
  assert.ok(codes.has('space-before-punctuation'));
});

test('project terminology proposes canonical spelling', () => {
  const state = createDefaultProofreadingState();
  state.dictionary.terms.push({ id: 'term:1', canonical: 'Лиарен', variants: ['Лиарэн'], note: 'Имя', caseSensitive: false });
  const finding = runDeterministicChecks('Лиарэн вошёл.', state).find(item => item.code === 'terminology');
  assert.equal(finding.replacement, 'Лиарен');
});

test('unsafe nested-quantifier regex is rejected', () => {
  assert.throws(() => validateRegexPattern('(a+)+$'), /опасное/);
});

test('search and replace supports safe regex preview', () => {
  const matches = findTextMatches('кот котёнок кот', '(?<![\\p{L}\\p{N}_])кот(?![\\p{L}\\p{N}_])', { regex: true });
  assert.equal(matches.length, 2);
  assert.equal(replaceTextMatches('кот котёнок кот', '(?<![\\p{L}\\p{N}_])кот(?![\\p{L}\\p{N}_])', 'пёс', { regex: true }), 'пёс котёнок пёс');
});

test('aggregate status exposes changed and attention before completion', () => {
  assert.equal(aggregateStatuses([{ status: 'reviewed' }, { status: 'changed' }]).status, 'changed');
  assert.equal(aggregateStatuses([{ status: 'reviewed' }, { status: 'attention' }]).status, 'attention');
  assert.equal(aggregateStatuses([{ status: 'reviewed' }, { status: 'reviewed' }]).percent, 100);
});

test('style analysis reports editorial readiness without claiming artistic quality', () => {
  const state = createDefaultProofreadingState();
  const units = [
    { type: 'narration', text: 'Короткая фраза. Ещё одна фраза.', status: 'reviewed', reviews: [] },
    { type: 'dialogue', text: 'Я согласен. Пойдём дальше.', status: 'reviewed', reviews: [] }
  ];
  const report = analyzeNovelStyle(units, state);
  assert.equal(report.reviewedPercent, 100);
  assert.ok(report.readinessScore >= 0 && report.readinessScore <= 100);
  assert.match(report.disclaimer, /не художественную ценность/i);
});

test('review fingerprint changes with text', () => {
  assert.notEqual(reviewFingerprint('a'), reviewFingerprint('b'));
});
