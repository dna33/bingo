const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateCells,
  uniqueCells,
  matchesVariant,
  validateVariant
} = require('../bingo-api/pilot/card-generator');
const { fingerprint } = require('../bingo-api/pilot/commands');
for (const columnMode of ['unrestricted', 'american75']) {
  test(`generator completes valid ${columnMode} layouts, including both range endpoints`, () => {
    const settings = { minNumber: 1, maxNumber: 75, columnMode };
    for (const value of ['min', 'max']) {
      const card = generateCells(settings, (min, max) => (value === 'min' ? min : max - 1));
      assert.ok(matchesVariant(card, settings));
      assert.equal(card[12], null);
      if (value === 'min') assert.ok(card.includes(1));
      else assert.ok(card.includes(75));
    }
    for (let i = 0; i < 250; i++) assert.ok(matchesVariant(generateCells(settings), settings));
  });
}
test('invalid and impossible variants are rejected before generating anything', () => {
  for (const settings of [
    {},
    { minNumber: 1, maxNumber: 23, columnMode: 'unrestricted' },
    { minNumber: 2, maxNumber: 75, columnMode: 'american75' },
    { minNumber: 1, maxNumber: 1001, columnMode: 'unrestricted' }
  ]) {
    assert.throws(
      () => validateVariant(settings),
      (error) => error.publicCode === 'card_variant'
    );
  }
});
test('layout collisions retry and then fail explicitly, never reuse a full layout', () => {
  const settings = { minNumber: 1, maxNumber: 75, columnMode: 'unrestricted' };
  const first = generateCells(settings, (min) => min);
  const second = [...first];
  [second[0], second[1]] = [second[1], second[0]];
  const used = new Set([fingerprint(first)]);
  let calls = 0;
  assert.deepEqual(
    uniqueCells(settings, used, () => (++calls === 1 ? first : second)),
    second
  );
  assert.equal(calls, 2);
  assert.throws(
    () => uniqueCells(settings, used, () => first),
    (error) => error.publicCode === 'card_collision'
  );
});
