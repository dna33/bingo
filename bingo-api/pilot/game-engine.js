const failure = require('./errors');
const names = ['F', 'A', 'B', 'U', 'L', 'S', 'O'];
const pools = Object.fromEntries(names.map((name) => [name, name === 'O' ? 100000 : 50000]));
function invalid(code, message) {
  return Object.assign(failure(400, message), { publicCode: code });
}
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
    'confirmationReference',
    'nearMissThresholds'
  ];
  if (!input || typeof input !== 'object' || Object.keys(input).some((k) => !allowed.includes(k)))
    throw invalid('game_configuration', 'Complete game rules are required');
  if (!['independent', 'simultaneous'].includes(input.roundMode))
    throw invalid('game_round_mode', 'Choose a valid round mode');
  if (!['manual', 'digital'].includes(input.extractionMode))
    throw invalid('game_extraction_mode', 'Choose a valid extraction mode');
  if (typeof input.repeatWinners !== 'boolean')
    throw invalid('game_repeat_winners', 'State whether a card can win more than one figure');
  if (typeof input.pauseDuringContact !== 'boolean')
    throw invalid('game_pause_contact', 'State whether the game pauses while contacting candidates');
  if (input.roundingPolicy !== 'auditable_residual_draw')
    throw invalid('game_rounding_policy', 'Choose a valid residual rounding policy');
  if (!['redistribute_confirmed', 'redispute_remainder'].includes(input.discardPolicy))
    throw invalid('game_discard_policy', 'Choose what happens to the share of non-respondents');
  if (!['redispute_same_figure', 'advance_keep_unassigned'].includes(input.noResponsePolicy))
    throw invalid('game_no_response_policy', 'Choose what happens if nobody responds');
  if (input.contactClockStart !== 'operator_confirms_notice')
    throw invalid('game_contact_clock', 'Choose when the contact minute starts');
  if (input.maskReviewConfirmed !== true) throw invalid('game_mask_review', 'Confirm the mask review checkbox');
  if (
    typeof input.confirmationReference !== 'string' ||
    !input.confirmationReference.trim() ||
    input.confirmationReference.length > 1000
  )
    throw invalid('game_confirmation_reference', 'Provide a rules confirmation reference');
  if (
    !Array.isArray(input.order) ||
    input.order.length !== 7 ||
    new Set(input.order).size !== 7 ||
    input.order.some((n) => !names.includes(n))
  )
    throw invalid('game_order', 'The figure order must list F,A,B,U,L,S,O exactly once each');
  if (
    !Array.isArray(input.figures) ||
    input.figures.length !== 7 ||
    new Set(input.figures.map((f) => f && f.name)).size !== 7
  )
    throw invalid('game_figures_set', 'Provide exactly the seven figures with distinct names');
  if (
    !Array.isArray(input.nearMissThresholds) ||
    input.nearMissThresholds.length > 10 ||
    new Set(input.nearMissThresholds).size !== input.nearMissThresholds.length ||
    input.nearMissThresholds.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 20)
  )
    throw invalid('game_near_miss', 'Near-miss thresholds must be unique integers from 1 to 20 (up to 10)');
  if (input.roundMode === 'simultaneous' && !input.repeatWinners)
    throw invalid('game_cross_figure_policy', 'Cross-figure arbitration is not configured');
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
    maskReviewConfirmed: true,
    nearMissThresholds: [...input.nearMissThresholds].sort((a, b) => a - b)
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
function evaluate(roster, figures, drawnNumbers, seen = new Set(), excluded = new Set(), proximityThresholds = []) {
  const drawn = new Set(drawnNumbers),
    completions = [],
    summaries = [],
    thresholds = new Set(proximityThresholds);
  for (const figure of figures) {
    const nearest = [];
    const proximityCounts = {};
    for (const distance of thresholds) proximityCounts[distance] = 0;
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
        if (thresholds.has(status.missingNumbers.length)) proximityCounts[status.missingNumbers.length] += 1;
        nearest.push(item);
        nearest.sort(
          (a, b) => a.missingNumbers.length - b.missingNumbers.length || a.cardId.localeCompare(b.cardId)
        );
        if (nearest.length > 10) nearest.pop();
      }
    }
    summaries.push({ figure: figure.name, evaluatedCards, nearCards: nearest, proximityCounts });
  }
  return { completions, summaries };
}
module.exports = { names, pools, validateConfiguration, progress, evaluate };
