const mongoose = require('mongoose');
const { randomInt } = require('node:crypto');
const M = require('./models');
const { execute, audit, fingerprint } = require('./commands');
const { recordEvaluatedDraw } = require('./persistence');
const { reconciliation } = require('./imports');
const { matchesVariant } = require('./card-generator');
const { sha256 } = require('./cards');
const engine = require('./game-engine');
const failure = require('./errors');
const fail = (code) => Object.assign(failure(409, 'Game operation blocked'), { publicCode: code });
const pendingStates = ['detected', 'contacting', 'awaiting_response'];
async function configuration(edition, session) {
  if (!edition.gameConfigurationId) throw fail('game_configuration_required');
  const config = await M.GameConfiguration.findOne({
    _id: edition.gameConfigurationId,
    editionId: edition._id
  }).session(session);
  if (!config) throw fail('game_configuration_required');
  return config;
}
async function configure(command) {
  const rules = engine.validateConfiguration(command.input.settings);
  return execute({ ...command, action: 'game.configured' }, async ({ edition, session }) => {
    if (edition.state !== 'preparation') throw fail('game_frozen');
    if (!edition.cardSettings || !edition.cardSettingsLockedAt) throw fail('card_confirmation_required');
    const [config] = await M.GameConfiguration.create(
      [
        {
          editionId: edition._id,
          version: edition.version,
          rules,
          confirmationReference: command.input.settings.confirmationReference.trim(),
          confirmedBy: command.actorId,
          confirmedAt: new Date()
        }
      ],
      { session }
    );
    edition.gameConfigurationId = config._id;
    await edition.save({ session });
    return { version: edition.version, configurationId: config.id };
  });
}
async function prepare(command) {
  return execute({ ...command, action: 'game.prepared' }, async ({ edition, session }) => {
    if (edition.state !== 'preparation') throw fail('game_state');
    await configuration(edition, session);
    if (!edition.listClosedAt || !(await reconciliation(edition, session)).canClose)
      throw fail('reconciliation_incomplete');
    if (await M.GameRoster.exists({ editionId: edition._id }).session(session))
      throw fail('game_roster_exists');
    const people = await M.Participant.find({ editionId: edition._id, active: true })
      .select('_id')
      .session(session)
      .lean();
    const cards = await M.Card.find({
      editionId: edition._id,
      participantId: { $in: people.map((p) => p._id) }
    })
      .session(session)
      .lean();
    const pdfs = await M.CardPdf.find({ editionId: edition._id, cardId: { $in: cards.map((c) => c._id) } })
      .select('+bytes')
      .session(session);
    const byCard = new Map(pdfs.map((pdf) => [String(pdf.cardId), pdf]));
    const roster = cards.map((card) => {
      const pdf = byCard.get(String(card._id));
      if (
        !matchesVariant(card.cells, edition.cardSettings) ||
        fingerprint(card.cells) !== card.layoutHash ||
        !pdf ||
        !card.pdf ||
        sha256(pdf.bytes) !== card.pdf.sha256 ||
        pdf.sha256 !== card.pdf.sha256
      )
        throw fail('pdf_integrity');
      return {
        editionId: edition._id,
        participantId: card.participantId,
        cardId: card._id,
        sourceRowId: card.sourceRowId,
        cells: card.cells,
        layoutHash: card.layoutHash,
        pdfSha256: card.pdf.sha256
      };
    });
    if (roster.length !== people.length) throw fail('reconciliation_incomplete');
    await M.GameRoster.insertMany(roster, { session });
    edition.state = 'ready';
    edition.gamePreparedAt = new Date();
    await edition.save({ session });
    return { version: edition.version, state: edition.state, participants: roster.length };
  });
}
async function openRound(edition, config, ordinal, session) {
  const rules = config.rules;
  const figures = rules.roundMode === 'independent' ? [rules.order[ordinal]] : rules.order;
  if (figures.some((name) => !name)) throw fail('game_rounds_complete');
  const roster = await M.GameRoster.find({ editionId: edition._id }).session(session).lean();
  const definitions = rules.figures.filter((f) => figures.includes(f.name));
  const [round] = await M.Round.create(
    [
      {
        editionId: edition._id,
        ordinal,
        state: 'playing',
        rulesVersion: config.version,
        gameConfigurationId: config._id,
        figures,
        minNumber: edition.cardSettings.minNumber,
        maxNumber: edition.cardSettings.maxNumber,
        startedAt: new Date(),
        progress: engine.evaluate(roster, definitions, [], new Set(), new Set(), rules.nearMissThresholds)
          .summaries
      }
    ],
    { session }
  );
  await M.FigureResult.insertMany(
    definitions.map((f) => ({
      editionId: edition._id,
      roundId: round._id,
      gameConfigurationId: config._id,
      figure: f.name,
      poolClp: f.poolClp
    })),
    { session }
  );
  edition.currentRoundId = round._id;
  edition.state = 'playing';
  await edition.save({ session });
  return round;
}
async function start(command) {
  return execute({ ...command, action: 'game.started' }, async ({ edition, session }) => {
    if (edition.state !== 'ready' || edition.currentRoundId) throw fail('game_state');
    const config = await configuration(edition, session);
    const round = await openRound(edition, config, 0, session);
    edition.gameStartedAt = new Date();
    await edition.save({ session });
    return { version: edition.version, state: edition.state, roundId: round.id };
  });
}
async function activeRound(edition, session) {
  if (!edition.currentRoundId) throw fail('game_state');
  const round = await M.Round.findOne({ _id: edition.currentRoundId, editionId: edition._id }).session(
    session
  );
  if (!round) throw fail('game_state');
  return round;
}
async function pause(command) {
  return execute({ ...command, action: 'game.paused' }, async ({ edition, session }) => {
    if (edition.state !== 'playing') throw fail('game_state');
    const round = await activeRound(edition, session);
    edition.state = 'paused';
    round.state = 'paused';
    round.pauseReason = 'operator';
    await edition.save({ session });
    await round.save({ session });
    return { version: edition.version, state: edition.state };
  });
}
async function resume(command) {
  return execute({ ...command, action: 'game.resumed' }, async ({ edition, session }) => {
    if (edition.state !== 'paused') throw fail('game_state');
    const round = await activeRound(edition, session),
      config = await configuration(edition, session);
    if (
      config.rules.pauseDuringContact &&
      (await M.Candidate.exists({
        roundId: round._id,
        cohort: 'primary',
        state: { $in: pendingStates }
      }).session(session))
    )
      throw fail('game_pending_contact');
    edition.state = 'playing';
    round.state = 'playing';
    round.pauseReason = undefined;
    await edition.save({ session });
    await round.save({ session });
    return { version: edition.version, state: edition.state };
  });
}
async function draw(command) {
  return recordEvaluatedDraw(
    command,
    async ({ edition, round, draw: ball, session }) => {
      const config = await configuration(edition, session);
      const numbers = (
        await M.Draw.find({ roundId: round._id })
          .sort({ sequence: 1 })
          .select('number')
          .session(session)
          .lean()
      ).map((d) => d.number);
      const results = await M.FigureResult.find({
        roundId: round._id,
        state: { $in: ['open', 'detected'] }
      }).session(session);
      const seenRows = await M.Candidate.find({ roundId: round._id })
        .select('cardId figure')
        .session(session)
        .lean();
      const seen = new Set(seenRows.map((c) => `${c.figure}:${c.cardId}`));
      const confirmed = config.rules.repeatWinners
        ? []
        : await M.Award.find({
            editionId: edition._id,
            amountClp: { $gt: 0 },
            state: { $in: ['confirmed', 'delivered'] }
          })
            .select('participantId')
            .session(session)
            .lean();
      const excluded = new Set(confirmed.map((c) => String(c.participantId)));
      const roster = await M.GameRoster.find({ editionId: edition._id }).session(session).lean();
      if (!roster.length || roster.some((c) => fingerprint(c.cells) !== c.layoutHash))
        throw fail('game_roster_integrity');
      const definitions = config.rules.figures.filter((f) =>
        results.some((result) => result.figure === f.name)
      );
      const evaluated = engine.evaluate(
        roster,
        definitions,
        numbers,
        seen,
        excluded,
        config.rules.nearMissThresholds
      );
      const candidates = [];
      let primaryFound = false;
      for (const result of results) {
        const completed = evaluated.completions.filter((c) => c.figure === result.figure);
        if (!completed.length) continue;
        const primary = result.state === 'open';
        if (primary) {
          result.state = 'detected';
          result.firstDrawId = ball._id;
          result.firstSequence = ball.sequence;
          result.primaryCandidateCount = completed.length;
          primaryFound = true;
        } else result.reserveCandidateCount += completed.length;
        await result.save({ session });
        const definition = definitions.find((f) => f.name === result.figure);
        for (const card of completed)
          candidates.push({
            cardId: card.cardId,
            figure: result.figure,
            maskVersion: config.version,
            cohort: primary ? 'primary' : 'reserve',
            allocationCycle: result.allocationCycle || 0,
            evidence: {
              gameConfigurationId: config.id,
              mask: definition.mask,
              cells: card.cells,
              layoutHash: fingerprint(card.cells),
              requiredPositions: card.requiredPositions,
              drawnNumbers: numbers,
              sequence: ball.sequence,
              number: ball.number,
              drawnAt: ball.drawnAt.toISOString()
            }
          });
      }
      round.progress = evaluated.summaries;
      if (primaryFound && config.rules.pauseDuringContact) {
        edition.state = 'paused';
        round.state = 'paused';
        round.pauseReason = 'candidates';
        await edition.save({ session });
      }
      ball.evaluatedCards = roster.length;
      await audit(session, {
        editionId: edition._id,
        actorId: command.actorId,
        action: 'game.draw_confirmed',
        resourceId: ball._id,
        sequence: ball.sequence
      });
      return candidates;
    },
    async ({ edition, session }) => {
      const config = await configuration(edition, session),
        round = await activeRound(edition, session);
      if (!command.input.roundId || String(command.input.roundId) !== round.id || round.state !== 'playing')
        throw fail('game_round_changed');
      const numbers = new Set(
        (await M.Draw.find({ roundId: round._id }).select('number').session(session).lean()).map(
          (d) => d.number
        )
      );
      if (numbers.size >= round.maxNumber - round.minNumber + 1) throw fail('game_exhausted');
      let number = command.input.number;
      if (config.rules.extractionMode === 'digital') {
        if (number !== undefined) throw fail('game_digital_number');
        const available = Array.from(
          { length: round.maxNumber - round.minNumber + 1 },
          (_, i) => round.minNumber + i
        ).filter((n) => !numbers.has(n));
        number = available[randomInt(available.length)];
      }
      if (!Number.isSafeInteger(number) || number < round.minNumber || number > round.maxNumber)
        throw failure(400, 'Invalid official number');
      if (numbers.has(number)) throw fail('game_duplicate');
      return { roundId: round._id, number, origin: config.rules.extractionMode };
    }
  );
}
async function nextRound(command) {
  return execute({ ...command, action: 'game.round_opened' }, async ({ edition, session }) => {
    if (!['playing', 'paused'].includes(edition.state)) throw fail('game_state');
    const config = await configuration(edition, session),
      round = await activeRound(edition, session);
    if (config.rules.roundMode !== 'independent' || round.ordinal >= config.rules.order.length - 1)
      throw fail('game_rounds_complete');
    if (!(await M.FigureResult.exists({ roundId: round._id, state: { $ne: 'open' } }).session(session)))
      throw fail('game_round_incomplete');
    if (
      (config.rules.pauseDuringContact || !config.rules.repeatWinners) &&
      (await M.Candidate.exists({
        editionId: edition._id,
        cohort: 'primary',
        state: { $in: pendingStates }
      }).session(session))
    )
      throw fail('game_pending_contact');
    if (
      await M.FigureResult.exists({
        roundId: round._id,
        state: { $nin: ['adjudicated', 'unassigned'] }
      }).session(session)
    )
      throw fail('prize_pending_settlement');
    round.state = 'finished';
    round.finishedAt = new Date();
    await round.save({ session });
    const next = await openRound(edition, config, round.ordinal + 1, session);
    return { version: edition.version, roundId: next.id, state: edition.state };
  });
}
async function incident(command) {
  const { reason, kind = 'operation', drawId } = command.input;
  if (
    typeof reason !== 'string' ||
    !reason.trim() ||
    reason.length > 2000 ||
    !['entry_error', 'operation', 'recovery', 'finalization'].includes(kind)
  )
    throw failure(400, 'An incident reason is required');
  return execute({ ...command, action: 'game.incident_recorded' }, async ({ edition, session }) => {
    if (
      drawId &&
      (!mongoose.isValidObjectId(drawId) ||
        !(await M.Draw.exists({ _id: drawId, editionId: edition._id }).session(session)))
    )
      throw failure(404, 'Draw not found');
    await M.GameIncident.create(
      [
        {
          editionId: edition._id,
          roundId: edition.currentRoundId,
          drawId,
          operatorId: command.actorId,
          kind,
          reason: reason.trim(),
          occurredAt: new Date()
        }
      ],
      { session }
    );
    if (edition.state === 'playing') {
      const round = await activeRound(edition, session);
      round.state = 'paused';
      round.pauseReason = 'incident';
      edition.state = 'paused';
      await round.save({ session });
      await edition.save({ session });
    }
    return { version: edition.version, state: edition.state };
  });
}
async function finish(command) {
  const reason = command.input.reason;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000)
    throw failure(400, 'A finalization reason is required');
  return execute({ ...command, action: 'game.finished' }, async ({ edition, session }) => {
    if (!['ready', 'playing', 'paused'].includes(edition.state)) throw fail('game_state');
    if (
      await M.FigureResult.exists({
        editionId: edition._id,
        $or: [{ state: 'detected' }, { state: 'open', allocationCycle: { $gt: 0 } }]
      }).session(session)
    )
      throw fail('prize_pending_settlement');
    if (edition.currentRoundId) {
      const round = await activeRound(edition, session);
      round.state = 'finished';
      round.finishedAt = new Date();
      await round.save({ session });
    }
    await M.GameIncident.create(
      [
        {
          editionId: edition._id,
          roundId: edition.currentRoundId,
          operatorId: command.actorId,
          kind: 'finalization',
          reason: reason.trim(),
          occurredAt: new Date()
        }
      ],
      { session }
    );
    edition.state = 'finished';
    edition.gameFinishedAt = new Date();
    await edition.save({ session });
    return { version: edition.version, state: edition.state };
  });
}
module.exports = { configure, prepare, start, pause, resume, draw, nextRound, incident, finish };
