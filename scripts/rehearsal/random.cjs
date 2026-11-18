const { createHmac } = require('node:crypto');
function random(seed) {
  let counter = 0;
  return (min, max) => {
    const bound = max - min;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || bound < 1 || bound > 0x100000000)
      throw new Error('Invalid seeded random bounds');
    const limit = Math.floor(0x100000000 / bound) * bound;
    let value;
    do {
      value = createHmac('sha256', seed).update(String(counter++)).digest().readUInt32BE(0);
    } while (value >= limit);
    return min + (value % bound);
  };
}
function shuffle(values, draw) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = draw(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => (sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null);
  return {
    samples: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1) ?? null
  };
}
module.exports = { random, shuffle, stats };
