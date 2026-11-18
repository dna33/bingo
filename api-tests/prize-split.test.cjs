const { test } = require('node:test');
const assert = require('node:assert/strict');
const { split } = require('../bingo-api/pilot/prize-split');
test('residual split is integer, exact, reproducible and independent of input iteration order', () => {
  const seed = 'ab'.repeat(32),
    ids = ['z', 'a', 'm'];
  const result = split(50000, ids, seed);
  assert.deepEqual(result, split(50000, [...ids].reverse(), seed));
  assert.equal(
    result.shares.reduce((sum, s) => sum + s.amountClp, 0),
    50000
  );
  assert.equal(result.residualClp, 2);
  assert.equal(
    Math.max(...result.shares.map((s) => s.amountClp)) - Math.min(...result.shares.map((s) => s.amountClp)),
    1
  );
  assert.equal(
    split(0, ids, seed).shares.reduce((s, x) => s + x.amountClp, 0),
    0
  );
  assert.equal(split(1, ids, seed).shares.filter((s) => s.amountClp === 1).length, 1);
});
test('split rejects fractional/negative/unsafe amounts and duplicate contenders', () => {
  for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => split(amount, ['a'], 'ff'.repeat(32)));
  assert.throws(() => split(1, ['a', 'a'], 'ff'.repeat(32)));
  assert.throws(() => split(1, [], 'ff'.repeat(32)));
});
