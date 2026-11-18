const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../bingo-api/pilot/game-engine');
const base = () => ({
  roundMode: 'independent',
  extractionMode: 'manual',
  order: E.names,
  repeatWinners: true,
  pauseDuringContact: false,
  roundingPolicy: 'auditable_residual_draw',
  discardPolicy: 'redistribute_confirmed',
  noResponsePolicy: 'advance_keep_unassigned',
  contactClockStart: 'operator_confirms_notice',
  maskReviewConfirmed: true,
  confirmationReference: 'Synthetic rules',
  figures: E.names.map((name) => ({
    name,
    poolClp: E.pools[name],
    mask: ['10000', '00000', '00100', '00000', '00000']
  }))
});
test('all adjudication-relevant rules and reviewed masks are required before configuring', () => {
  const rules = base();
  assert.equal(E.validateConfiguration(rules).figures.length, 7);
  for (const key of [
    'roundMode',
    'extractionMode',
    'repeatWinners',
    'pauseDuringContact',
    'roundingPolicy',
    'discardPolicy',
    'noResponsePolicy',
    'contactClockStart',
    'maskReviewConfirmed',
    'confirmationReference'
  ]) {
    const invalid = { ...rules };
    delete invalid[key];
    assert.throws(
      () => E.validateConfiguration(invalid),
      (e) => e.publicCode === 'game_configuration'
    );
  }
  assert.throws(
    () => E.validateConfiguration({ ...rules, roundMode: 'simultaneous', repeatWinners: false }),
    (e) => e.publicCode === 'game_cross_figure_policy'
  );
  assert.throws(
    () =>
      E.validateConfiguration({
        ...rules,
        figures: rules.figures.map((f) => ({ ...f, mask: ['00000', '00000', '00100', '00000', '00000'] }))
      }),
    (e) => e.publicCode === 'game_mask'
  );
});
test('free center is always satisfied and marks outside the mask do not invalidate a completion', () => {
  const cells = Array.from({ length: 25 }, (_, i) => (i === 12 ? null : i + 1)),
    mask = ['10000', '00000', '00100', '00000', '00000'];
  assert.deepEqual(E.progress(cells, mask, new Set()).matchedPositions, [12]);
  assert.equal(E.progress(cells, mask, new Set([1, 5, 9, 10])).complete, true);
  assert.deepEqual(E.progress(cells, mask, new Set()).missingNumbers, [1]);
});
test('every tied card and figure is returned regardless of processing order, without duplicate detections', () => {
  const cells = Array.from({ length: 25 }, (_, i) => (i === 12 ? null : i + 1));
  const roster = ['a', 'b', 'c'].map((id) => ({ cardId: id, participantId: id, cells }));
  const figures = base().figures;
  const one = E.evaluate(roster, figures, [1]);
  const two = E.evaluate([...roster].reverse(), figures, [1]);
  assert.deepEqual(
    one.completions.map((c) => `${c.figure}:${c.cardId}`).sort(),
    two.completions.map((c) => `${c.figure}:${c.cardId}`).sort()
  );
  assert.equal(one.completions.length, 21);
  const seen = new Set(one.completions.map((c) => `${c.figure}:${c.cardId}`));
  assert.equal(E.evaluate(roster, figures, [1, 2], seen).completions.length, 0);
  assert.equal(E.evaluate(roster, figures, [1], new Set(), new Set(['b'])).completions.length, 14);
});
module.exports = { base };

test('10000-card pure-engine sensitivity keeps every candidate and bounded progress output', () => {
  const { performance } = require('node:perf_hooks');
  const cells = Array.from({ length: 25 }, (_, i) => (i === 12 ? null : i + 1));
  const roster = Array.from({ length: 10000 }, (_, i) => ({
    cardId: `synthetic-${i}`,
    participantId: `person-${i}`,
    cells
  }));
  const started = performance.now();
  const evaluated = E.evaluate(roster, base().figures, [1]);
  assert.equal(evaluated.completions.length, 70000);
  assert.ok(evaluated.summaries.every((s) => s.evaluatedCards === 10000 && s.nearCards.length <= 10));
  console.log(
    'GAME_ENGINE_SENSITIVITY',
    JSON.stringify({
      cards: 10000,
      figures: 7,
      completions: 70000,
      engineMs: Math.round(performance.now() - started),
      scope: 'pure engine, synthetic repeated layouts, no MongoDB or HTTP'
    })
  );
});
