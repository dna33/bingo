const { createHmac } = require('node:crypto');
// Stable input ordering plus a recorded 256-bit seed makes the draw reproducible.
// Rejection sampling avoids modulo bias. The seed is private until a proposal exists.
function split(amount, candidateIds, seed) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !candidateIds.length ||
    new Set(candidateIds).size !== candidateIds.length ||
    !/^[a-f0-9]{64}$/.test(seed)
  )
    throw new Error('Invalid prize split');
  const ids = [...candidateIds].sort(),
    shuffled = [...ids];
  let counter = 0;
  const uniform = (bound) => {
    const limit = Math.floor(0x100000000 / bound) * bound;
    let n;
    do {
      n = createHmac('sha256', Buffer.from(seed, 'hex'))
        .update(`bingo-residual-v1:${counter++}`)
        .digest()
        .readUInt32BE(0);
    } while (n >= limit);
    return n % bound;
  };
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = uniform(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const baseClp = Math.floor(amount / ids.length),
    residualClp = amount % ids.length;
  const extras = new Set(shuffled.slice(0, residualClp));
  return {
    baseClp,
    residualClp,
    extraCandidateIds: [...extras],
    shares: ids.map((candidateId) => ({ candidateId, amountClp: baseClp + Number(extras.has(candidateId)) }))
  };
}
module.exports = { split };
