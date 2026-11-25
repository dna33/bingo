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
  nearMissThresholds: [1, 2, 3],
  figures: E.names.map((name) => ({
    name,
    poolClp: name === 'O' ? 100000 : 50000,
    mask: ['10000', '00000', '00100', '00000', '00000']
  }))
});
test('all adjudication-relevant rules and reviewed masks are required before configuring', () => {
  const rules = base();
  assert.equal(E.validateConfiguration(rules).figures.length, 7);
  for (const [key, code] of [
    ['roundMode', 'game_round_mode'],
    ['extractionMode', 'game_extraction_mode'],
    ['repeatWinners', 'game_repeat_winners'],
    ['pauseDuringContact', 'game_pause_contact'],
    ['roundingPolicy', 'game_rounding_policy'],
    ['discardPolicy', 'game_discard_policy'],
    ['noResponsePolicy', 'game_no_response_policy'],
    ['contactClockStart', 'game_contact_clock'],
    ['maskReviewConfirmed', 'game_mask_review'],
    ['confirmationReference', 'game_confirmation_reference'],
    ['nearMissThresholds', 'game_near_miss']
  ]) {
    const invalid = { ...rules };
    delete invalid[key];
    assert.throws(
      () => E.validateConfiguration(invalid),
      (e) => e.publicCode === code
    );
  }
  assert.deepEqual(E.validateConfiguration({ ...rules, nearMissThresholds: [] }).nearMissThresholds, []);
  assert.deepEqual(
    E.validateConfiguration({ ...rules, nearMissThresholds: [3, 1, 2] }).nearMissThresholds,
    [1, 2, 3]
  );
  for (const nearMissThresholds of [[1, 1], [0], [21], ['1'], Array(11).fill(1).map((_, i) => i + 1)]) {
    assert.throws(
      () => E.validateConfiguration({ ...rules, nearMissThresholds }),
      (e) => e.publicCode === 'game_near_miss'
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
test('an edition can play anywhere from 1 to 7 figures, as long as their pools add up to exactly 400000', () => {
  const rules = base();
  const only = {
    ...rules,
    order: ['F'],
    figures: [{ name: 'F', mask: rules.figures[0].mask, poolClp: 400000 }]
  };
  assert.deepEqual(E.validateConfiguration(only).order, ['F']);
  assert.equal(E.validateConfiguration(only).figures.length, 1);
  assert.throws(
    () => E.validateConfiguration({ ...rules, order: [], figures: [] }),
    (e) => e.publicCode === 'game_order'
  );
  assert.throws(
    () => E.validateConfiguration({ ...rules, order: [...rules.order, 'F'] }),
    (e) => e.publicCode === 'game_order'
  );
  assert.throws(
    () =>
      E.validateConfiguration({
        ...only,
        figures: [{ ...only.figures[0], poolClp: 399999 }]
      }),
    (e) => e.publicCode === 'game_pool_total'
  );
  assert.throws(
    () => E.validateConfiguration({ ...only, figures: [{ ...only.figures[0], poolClp: -1 }] }),
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
test('proximity counts for configured near-miss distances are exact, not capped to the ten displayed near cards', () => {
  const mask = ['10000', '00000', '00100', '00000', '00000']; // one required non-free cell besides the free center
  const roster = Array.from({ length: 15 }, (_, i) => {
    const cells = Array.from({ length: 25 }, (_, p) => (p === 12 ? null : p + 1));
    cells[0] = i; // every card still misses exactly one required number: distance 1
    return { cardId: `card-${i}`, participantId: `person-${i}`, cells };
  });
  const figures = [{ name: 'F', mask, poolClp: 400000 }];
  const evaluated = E.evaluate(roster, figures, [], new Set(), new Set(), [1, 2, 3]);
  const summary = evaluated.summaries[0];
  assert.equal(summary.nearCards.length, 10); // display list stays capped
  assert.equal(summary.proximityCounts[1], 15); // but the count reflects every near card
  assert.equal(summary.proximityCounts[2], 0);
  assert.equal(summary.proximityCounts[3], 0);
});
test('proximity counts are omitted for distances outside the configured thresholds', () => {
  const figures = base().figures;
  const cells = Array.from({ length: 25 }, (_, i) => (i === 12 ? null : i + 1));
  const roster = [{ cardId: 'a', participantId: 'a', cells }];
  const evaluated = E.evaluate(roster, figures, [], new Set(), new Set(), []);
  assert.deepEqual(evaluated.summaries[0].proximityCounts, {});
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
