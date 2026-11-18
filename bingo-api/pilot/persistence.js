const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const models = require('./models');
const { execute, audit, fingerprint } = require('./commands');
const failure = require('./errors');

async function createEdition({ name, editionId, actorId }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 150 || !mongoose.isValidObjectId(editionId)) {
    throw failure(400, 'A name and client-generated editionId are required');
  }
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await models.Edition.findById(editionId).session(session);
      if (existing) {
        if (existing.name !== name.trim() || String(existing.createdBy) !== String(actorId)) throw failure(409, 'Edition already exists');
        result = { id: existing.id, version: 0 }; return;
      }
      const [edition] = await models.Edition.create([{ _id: editionId, name: name.trim(), createdBy: actorId }], { session });
      await models.ConfigVersion.create([{ editionId, version: 0, rules: {}, createdBy: actorId }], { session });
      await audit(session, { editionId, actorId, action: 'edition.created', resourceId: editionId, version: 0 });
      result = { id: edition.id, version: 0 };
    }, { writeConcern: { w: 'majority' } });
    return result;
  } finally { await session.endSession(); }
}
function validateRules(rules) {
  const allowed = new Set(['minNumber', 'maxNumber', 'columnMode', 'roundMode', 'extractionMode', 'repeatWinners',
    'roundingPolicy', 'pauseDuringContact', 'discardPolicy', 'noResponsePolicy', 'contactClockStart']);
  if (!rules || typeof rules !== 'object' || Array.isArray(rules) || Object.keys(rules).some(k => !allowed.has(k))) {
    throw failure(400, 'Unsupported configuration fields');
  }
  // Stage 1 stores only bounded scalar draft rules, never contact data or arbitrary nested payloads.
  for (const value of Object.values(rules)) {
    if (value !== null && typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isSafeInteger(value)) &&
      !(typeof value === 'string' && /^[a-z0-9_-]{1,60}$/i.test(value))) throw failure(400, 'Invalid draft rule value');
  }
}
async function configureEdition(command) {
  validateRules(command.input.rules);
  return execute({ ...command, action: 'edition.configured' }, async ({ edition, session }) => {
    if (edition.state !== 'preparation') throw failure(409, 'Configuration is frozen');
    if (edition.cardSettings) {
      const keys = ['minNumber', 'maxNumber', 'columnMode'];
      const changesVariant = keys.some(key => command.input.rules[key] !== edition.cardSettings[key]);
      if (changesVariant && edition.cardSettingsLockedAt) throw Object.assign(failure(409, 'Card settings are locked'), { publicCode: 'card_settings_locked' });
      if (changesVariant) edition.cardSettings = undefined;
    }
    edition.gameConfigurationId = undefined;
    edition.rules = command.input.rules;
    await edition.save({ session });
    await models.ConfigVersion.create([{ editionId: edition._id, version: edition.version, rules: edition.rules, createdBy: command.actorId }], { session });
    return { id: edition.id, version: edition.version };
  });
}
function cardRecord({ editionId, participantId, sourceRowId, cells }) {
  return { editionId, participantId, sourceRowId, cells, cardCode: randomUUID(), layoutHash: fingerprint(cells) };
}
// Internal persistence boundary, not a public draw API. A future authoritative motor supplies
// a deterministic, side-effect-free evaluator. It must not send messages inside the transaction.
async function recordEvaluatedDraw(command, evaluate, prepareNumber) {
  if (typeof evaluate !== 'function') throw failure(400, 'An authoritative evaluator is required');
  return execute({ ...command, action: 'draw.evaluated' }, async ({ edition, session }) => {
    if (edition.state !== 'playing') throw failure(409, 'Edition is not playing');
    const { roundId, number, origin } = prepareNumber ? await prepareNumber({ edition, session }) : command.input;
    const round = await models.Round.findOne({ _id: roundId, editionId: edition._id, state: 'playing' }).session(session);
    if (!round || !Number.isSafeInteger(number) || number < round.minNumber || number > round.maxNumber) {
      throw failure(400, 'Invalid round or number');
    }
    const [draw] = await models.Draw.create([{ editionId: edition._id, roundId, sequence: round.lastSequence + 1,
      number, origin, drawnAt: new Date(), operatorId: command.actorId, evaluationComplete: true }], { session });
    const candidates = await evaluate({ session, edition, round, draw });
    if (!Array.isArray(candidates)) throw failure(400, 'Invalid evaluation result');
    const cards = await models.Card.find({ _id: { $in: candidates.map(c => c.cardId) }, editionId: edition._id }).select('_id participantId').session(session).lean();
    const byId = new Map(cards.map(card => [String(card._id), card]));
    const records = candidates.map(candidate => {
      const card = byId.get(String(candidate.cardId));
      if (!card) throw failure(400, 'Candidate card does not belong to this edition');
      return { editionId: edition._id, roundId, drawId: draw._id, participantId: card.participantId, cardId: card._id,
        figure: candidate.figure, maskVersion: candidate.maskVersion, evidence: candidate.evidence,
        allocationCycle: candidate.allocationCycle || 0, cohort: candidate.cohort || 'primary' };
    });
    if (records.length) {
      await models.Candidate.insertMany(records, { session });
      const groups = new Map();
      for (const row of records) {
        const key = `${row.figure}:${row.cohort}`;
        const group = groups.get(key) || { editionId: edition._id, roundId, drawId: draw._id,
          figure: row.figure, cohort: row.cohort, sequence: draw.sequence, candidateCount: 0 };
        group.candidateCount += 1;
        groups.set(key, group);
      }
      await models.CandidateAlert.insertMany([...groups.values()], { session });
    }
    draw.candidateCount = records.length;
    await draw.save({ session });
    round.lastSequence = draw.sequence;
    await round.save({ session });
    return { drawId: draw.id, roundId: String(roundId), number, sequence: draw.sequence, candidateCount: candidates.length, version: edition.version };
  });
}
module.exports = { createEdition, configureEdition, cardRecord, recordEvaluatedDraw };
