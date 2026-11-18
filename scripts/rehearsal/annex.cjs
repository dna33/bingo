const { generateCells } = require('../../bingo-api/pilot/card-generator');
const { progress } = require('../../bingo-api/pilot/game-engine');
const { random } = require('./random.cjs');
const masks = {
  F: ['11111', '10000', '11110', '10000', '10000'],
  A: ['01110', '10001', '11111', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '11110'],
  U: ['10001', '10001', '10001', '10001', '11111'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  S: ['11111', '10000', '11111', '00001', '11111'],
  O: ['11111', '10001', '10001', '10001', '11111']
};
function individual(k, m) {
  let value = 1;
  if (k < m) return 0;
  for (let i = 0; i < m; i++) value *= (k - i) / (75 - i);
  return value;
}
function theory(m, n) {
  const F = Array.from({ length: 76 }, (_, k) => individual(k, m));
  const survival = (k) => (F[k] === 1 ? 0 : Math.exp(n * Math.log1p(-F[k])));
  const cdf = (k) => -Math.expm1(n * Math.log1p(-F[k]));
  let unique = 0,
    expectedWinners = 0,
    expectedDraws = 0;
  for (let k = 1; k <= 75; k++) {
    const d = F[k] - F[k - 1];
    unique += n * d * (F[k] === 1 ? 0 : Math.exp((n - 1) * Math.log1p(-F[k])));
    expectedWinners += n * d * (F[k - 1] === 1 ? 0 : Math.exp((n - 1) * Math.log1p(-F[k - 1])));
    expectedDraws += survival(k - 1);
  }
  const quantile = (p) => Array.from({ length: 76 }, (_, k) => k).find((k) => cdf(k) >= p);
  return {
    required: m,
    at30: cdf(30),
    at40: cdf(40),
    at50: cdf(50),
    p10Draws: quantile(0.1),
    medianDraws: quantile(0.5),
    p90Draws: quantile(0.9),
    tieProbability: 1 - unique,
    expectedWinners,
    individualShareProbability: expectedWinners / n,
    expectedDraws
  };
}
function simulate({ cards = 3000, trials = 300, seed = 'bingo-etapa8-annex-v1' } = {}) {
  const draw = random(seed),
    figures = Object.entries(masks),
    records = Object.fromEntries(figures.map(([name]) => [name, []]));
  const checks = { engineProgressComparisons: 0, duplicateLayoutsRejected: 0 };
  // A fixed ball order is distribution-equivalent under uniform unrestricted cards.
  // Completion time is the maximum required number. Seven masks use the same card, preserving dependencies.
  const orderCounts = {};
  for (let trial = 0; trial < trials; trial++) {
    const first = Object.fromEntries(figures.map(([name]) => [name, { time: 76, winners: 0 }])),
      seen = new Set();
    for (let i = 0; i < cards; i++) {
      let cells, key;
      do {
        cells = generateCells({ minNumber: 1, maxNumber: 75, columnMode: 'unrestricted' }, draw);
        key = cells.join(',');
        if (seen.has(key)) checks.duplicateLayoutsRejected++;
      } while (seen.has(key));
      seen.add(key);
      for (const [name, mask] of figures) {
        let time = 0;
        for (let p = 0; p < 25; p++)
          if (p !== 12 && mask[Math.floor(p / 5)][p % 5] === '1') time = Math.max(time, cells[p]);
        if (time < first[name].time) first[name] = { time, winners: 1 };
        else if (time === first[name].time) first[name].winners++;
        if (trial < 3 && i < 10) {
          const at = new Set(Array.from({ length: time }, (_, k) => k + 1)),
            before = new Set(Array.from({ length: time - 1 }, (_, k) => k + 1));
          if (!progress(cells, mask, at).complete || progress(cells, mask, before).complete)
            throw new Error('Simulation disagrees with real evaluator');
          checks.engineProgressComparisons += 2;
        }
      }
    }
    for (const [name] of figures) records[name].push(first[name]);
    const order = figures
      .map(([name]) => name)
      .sort((a, b) => first[a].time - first[b].time || a.localeCompare(b))
      .join('');
    orderCounts[order] = (orderCounts[order] || 0) + 1;
  }
  const rows = Object.fromEntries(
    figures.map(([name, mask]) => {
      const m = mask
          .join('')
          .split('')
          .filter((x, i) => x === '1' && i !== 12).length,
        values = records[name],
        analytical = theory(m, cards);
      const frequency = (k) => values.filter((v) => v.time <= k).length / trials;
      const p = analytical.at40;
      return [
        name,
        {
          theory: analytical,
          simulation: {
            trials,
            at30: frequency(30),
            at40: frequency(40),
            at50: frequency(50),
            tieProbability: values.filter((v) => v.winners > 1).length / trials,
            meanFirstDraw: values.reduce((s, v) => s + v.time, 0) / trials,
            meanWinners: values.reduce((s, v) => s + v.winners, 0) / trials,
            at40StandardError: Math.sqrt((p * (1 - p)) / trials)
          }
        }
      ];
    })
  );
  return {
    seed,
    cards,
    trials,
    model:
      'uniform unrestricted 1..75; unique complete layouts; fixed draw order by symmetry; no response/payment model',
    masks,
    checks,
    rows,
    independentRoundsExpectedDraws: Object.values(rows).reduce((s, r) => s + r.theory.expectedDraws, 0),
    meanSimultaneousLastDraw:
      Array.from({ length: trials }, (_, i) =>
        Math.max(...figures.map(([name]) => records[name][i].time))
      ).reduce((a, b) => a + b, 0) / trials,
    OLastIncludingTies:
      Array.from({ length: trials }, (_, i) =>
        Number(records.O[i].time === Math.max(...figures.map(([name]) => records[name][i].time)))
      ).reduce((a, b) => a + b, 0) / trials,
    orderCounts
  };
}
module.exports = { masks, theory, simulate };
