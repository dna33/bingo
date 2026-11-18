const { randomInt } = require('node:crypto');
const failure = require('./errors');
const { fingerprint } = require('./commands');

function validateVariant(settings) {
  if (
    !settings ||
    !Number.isSafeInteger(settings.minNumber) ||
    !Number.isSafeInteger(settings.maxNumber) ||
    settings.minNumber < 1 ||
    settings.maxNumber > 1000 ||
    settings.maxNumber - settings.minNumber + 1 < 24 ||
    !['unrestricted', 'american75'].includes(settings.columnMode) ||
    (settings.columnMode === 'american75' && (settings.minNumber !== 1 || settings.maxNumber !== 75))
  ) {
    throw Object.assign(failure(400, 'Invalid card variant'), { publicCode: 'card_variant' });
  }
}
function sample(min, max, count, random = randomInt) {
  const pool = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  for (let i = 0; i < count; i++) {
    const j = random(i, pool.length);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
function generateCells(settings, random = randomInt) {
  validateVariant(settings);
  const cells = Array(25).fill(null);
  if (settings.columnMode === 'unrestricted') {
    const numbers = sample(settings.minNumber, settings.maxNumber, 24, random);
    let n = 0;
    for (let i = 0; i < cells.length; i++) if (i !== 12) cells[i] = numbers[n++];
  } else {
    for (let column = 0; column < 5; column++) {
      const numbers = sample(column * 15 + 1, column * 15 + 15, column === 2 ? 4 : 5, random);
      let n = 0;
      for (let row = 0; row < 5; row++) if (row !== 2 || column !== 2) cells[row * 5 + column] = numbers[n++];
    }
  }
  return cells;
}
function matchesVariant(cells, settings) {
  if (!Array.isArray(cells) || cells.length !== 25 || cells[12] !== null) return false;
  const values = cells.filter((_, i) => i !== 12);
  return (
    new Set(values).size === 24 &&
    values.every((n) => Number.isSafeInteger(n)) &&
    cells.every(
      (n, i) =>
        i === 12 ||
        (n >= settings.minNumber &&
          n <= settings.maxNumber &&
          (settings.columnMode !== 'american75' || (n >= (i % 5) * 15 + 1 && n <= (i % 5) * 15 + 15)))
    )
  );
}
function uniqueCells(settings, used, generate = generateCells) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const cells = generate(settings);
    if (!matchesVariant(cells, settings)) throw failure(500, 'Generator returned an invalid card');
    const hash = fingerprint(cells);
    if (!used.has(hash)) {
      used.add(hash);
      return cells;
    }
  }
  throw Object.assign(failure(409, 'Could not generate a unique card'), { publicCode: 'card_collision' });
}
module.exports = { validateVariant, generateCells, matchesVariant, uniqueCells };
