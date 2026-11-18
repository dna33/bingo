const failure = require('./errors');
const names = ['F', 'A', 'B', 'U', 'L', 'S', 'O'];
const pools = Object.fromEntries(names.map((name) => [name, name === 'O' ? 100000 : 50000]));
function validateConfiguration(input) {
  const allowed = [
    'roundMode',
    'extractionMode',
    'order',
    'figures',
    'repeatWinners',
    'pauseDuringContact',
    'roundingPolicy',
    'discardPolicy',
    'noResponsePolicy',
    'contactClockStart',
    'maskReviewConfirmed',
    'confirmationReference'
  ];
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).some((k) => !allowed.includes(k)) ||
    !['independent', 'simultaneous'].includes(input.roundMode) ||
    !['manual', 'digital'].includes(input.extractionMode) ||
    typeof input.repeatWinners !== 'boolean' ||
    typeof input.pauseDuringContact !== 'boolean' ||
    input.roundingPolicy !== 'auditable_residual_draw' ||
    !['redistribute_confirmed', 'redispute_remainder'].includes(input.discardPolicy) ||
    !['redispute_same_figure', 'advance_keep_unassigned'].includes(input.noResponsePolicy) ||
    input.contactClockStart !== 'operator_confirms_notice' ||
    input.maskReviewConfirmed !== true ||
    typeof input.confirmationReference !== 'string' ||
    !input.confirmationReference.trim() ||
    input.confirmationReference.length > 1000 ||
    !Array.isArray(input.order) ||
    input.order.length !== 7 ||
    new Set(input.order).size !== 7 ||
    input.order.some((n) => !names.includes(n)) ||
    !Array.isArray(input.figures) ||
    input.figures.length !== 7 ||
    new Set(input.figures.map((f) => f && f.name)).size !== 7
  ) {
    throw Object.assign(failure(400, 'Complete game rules are required'), {
      publicCode: 'game_configuration'
    });
  }
  if (input.roundMode === 'simultaneous' && !input.repeatWinners) {
    throw Object.assign(failure(400, 'Cross-figure arbitration is not configured'), {
      publicCode: 'game_cross_figure_policy'
    });
  }
  for (const figure of input.figures) {
    if (
      !figure ||
      Object.keys(figure).some((k) => !['name', 'mask', 'poolClp'].includes(k)) ||
      !names.includes(figure.name) ||
      figure.poolClp !== pools[figure.name] ||
      !Array.isArray(figure.mask) ||
      figure.mask.length !== 5 ||
      figure.mask.some((row) => typeof row !== 'string' || !/^[01]{5}$/.test(row)) ||
      !figure.mask
        .join('')
        .split('')
        .some((value, i) => value === '1' && i !== 12)
    ) {
      throw Object.assign(failure(400, 'Invalid figure or pool'), { publicCode: 'game_mask' });
    }
  }
  return {
    roundMode: input.roundMode,
    extractionMode: input.extractionMode,
    order: [...input.order],
    figures: input.figures.map((f) => ({ name: f.name, mask: [...f.mask], poolClp: f.poolClp })),
    repeatWinners: input.repeatWinners,
    pauseDuringContact: input.pauseDuringContact,
    roundingPolicy: input.roundingPolicy,
    discardPolicy: input.discardPolicy,
    noResponsePolicy: input.noResponsePolicy,
    contactClockStart: input.contactClockStart,
    maskReviewConfirmed: true
  };
}
function progress(cells, mask, drawn) {
  const requiredPositions = [],
    matchedPositions = [],
    pendingPositions = [],
    missingNumbers = [];
  for (let i = 0; i < 25; i++)
    if (mask[Math.floor(i / 5)][i % 5] === '1') {
      requiredPositions.push(i);
      if (i === 12 || drawn.has(cells[i])) matchedPositions.push(i);
      else {
        pendingPositions.push(i);
        missingNumbers.push(cells[i]);
      }
    }
  return {
    complete: pendingPositions.length === 0,
    requiredPositions,
    matchedPositions,
    pendingPositions,
    missingNumbers
  };
}
// Pure evaluator: no DOM, network, clock, player connection or manual marks.
function evaluate(roster, figures, drawnNumbers, seen = new Set(), excluded = new Set()) {
  const drawn = new Set(drawnNumbers),
    completions = [],
    summaries = [];
  for (const figure of figures) {
    const nearest = [];
    let evaluatedCards = 0;
    for (const card of roster) {
      if (excluded.has(String(card.participantId))) continue;
      evaluatedCards++;
      const status = progress(card.cells, figure.mask, drawn);
      const item = {
        cardId: String(card.cardId),
        participantId: String(card.participantId),
        cells: card.cells,
        ...status
      };
      if (status.complete && !seen.has(`${figure.name}:${card.cardId}`))
        completions.push({ ...item, figure: figure.name });
      if (!status.complete) {
        nearest.push(item);
        nearest.sort(
          (a, b) => a.missingNumbers.length - b.missingNumbers.length || a.cardId.localeCompare(b.cardId)
        );
        if (nearest.length > 10) nearest.pop();
      }
    }
    summaries.push({ figure: figure.name, evaluatedCards, nearCards: nearest });
  }
  return { completions, summaries };
}
module.exports = { names, pools, validateConfiguration, progress, evaluate };
