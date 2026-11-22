const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const M = require('./models');
const { execute, audit, fingerprint } = require('./commands');
const { cardRecord } = require('./persistence');
const { reconciliation } = require('./imports');
const { validateVariant, matchesVariant, uniqueCells } = require('./card-generator');
const { renderCardPdf, validatePrintable, TEMPLATE_VERSION } = require('./card-pdf');
const failure = require('./errors');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => Object.assign(failure(409, 'Card operation blocked'), { publicCode: code });
const variant = (settings) => ({
  minNumber: settings.minNumber,
  maxNumber: settings.maxNumber,
  columnMode: settings.columnMode
});
function editable(edition) {
  if (edition.state !== 'preparation' || edition.listClosedAt) throw fail('list_frozen');
}
function validateSettings(input, edition) {
  const allowed = [
    'minNumber',
    'maxNumber',
    'columnMode',
    'title',
    'eventDate',
    'eventTime',
    'timeZone',
    'confirmationReference'
  ];
  if (!input || typeof input !== 'object' || Object.keys(input).some((k) => !allowed.includes(k)))
    throw failure(400, 'Invalid card settings');
  validateVariant(input);
  const settings = {
    ...variant(input),
    title: input.title === undefined ? edition.name : input.title,
    eventDate: input.eventDate || '',
    eventTime: input.eventTime || '',
    timeZone: input.timeZone || ''
  };
  if (
    typeof settings.title !== 'string' ||
    !settings.title.trim() ||
    settings.title.length > 80 ||
    /[\x00-\x1f]/.test(settings.title)
  )
    throw failure(400, 'Invalid PDF title');
  settings.title = settings.title.trim();
  validatePrintable(settings.title);
  if (
    typeof settings.eventDate !== 'string' ||
    (settings.eventDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(settings.eventDate) ||
        !Number.isFinite(Date.parse(settings.eventDate)) ||
        new Date(settings.eventDate).toISOString().slice(0, 10) !== settings.eventDate))
  )
    throw failure(400, 'Invalid event date');
  if (
    typeof settings.eventTime !== 'string' ||
    (settings.eventTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(settings.eventTime))
  )
    throw failure(400, 'Invalid event time');
  if (
    typeof settings.timeZone !== 'string' ||
    settings.timeZone.length > 80 ||
    (settings.eventTime && !settings.timeZone)
  )
    throw failure(400, 'Time zone required');
  if (settings.timeZone) {
    try {
      new Intl.DateTimeFormat('es-CL', { timeZone: settings.timeZone });
    } catch (_) {
      throw failure(400, 'Invalid time zone');
    }
  }
  if (
    typeof input.confirmationReference !== 'string' ||
    !input.confirmationReference.trim() ||
    input.confirmationReference.length > 1000
  )
    throw fail('card_confirmation_required');
  return { ...settings, confirmationReference: input.confirmationReference.trim() };
}
async function configureCards(command) {
  return execute({ ...command, action: 'cards.settings_confirmed' }, async ({ session, edition }) => {
    editable(edition);
    if (edition.cardSettingsLockedAt) throw fail('card_settings_locked');
    const settings = validateSettings(command.input.settings, edition);
    const existing = await M.Card.find({ editionId: edition._id }).session(session);
    // Existing layouts are never replaced to make a new configuration fit.
    if (existing.some((card) => !matchesVariant(card.cells, settings) || card.presentation))
      throw fail('card_settings_locked');
    edition.gameConfigurationId = undefined;
    edition.cardSettings = {
      ...settings,
      version: edition.version,
      confirmedAt: new Date().toISOString(),
      confirmedBy: String(command.actorId)
    };
    edition.rules = { ...edition.rules, ...variant(settings) };
    await edition.save({ session });
    await M.ConfigVersion.create(
      [
        { editionId: edition._id, version: edition.version, rules: edition.rules, createdBy: command.actorId }
      ],
      { session }
    );
    return { version: edition.version, configured: true };
  });
}
function eligibleReport(report) {
  return (
    report.approvedImportId &&
    report.uniqueParticipants > 0 &&
    !report.pendingFiles &&
    [
      'unresolvedRows',
      'missingParticipantIds',
      'extraParticipantIds',
      'untraceableParticipantIds',
      'inconsistentCardIds'
    ].every((k) => !report[k].length)
  );
}
async function storePdf(card, session, render = renderCardPdf) {
  const bytes = await render(card);
  const digest = sha256(bytes);
  if (card.pdf && card.pdf.sha256 && card.pdf.sha256 !== digest) throw fail('pdf_integrity');
  const [pdf] = await M.CardPdf.create(
    [
      {
        editionId: card.editionId,
        cardId: card._id,
        bytes,
        sha256: digest,
        templateVersion: TEMPLATE_VERSION
      }
    ],
    { session }
  );
  card.pdf = { storageKey: `mongodb:pilotcardpdfs:${pdf.id}`, sha256: digest };
  await card.save({ session });
}
async function issueBatch(command, dependencies = {}) {
  const limit = command.input.limit === undefined ? 50 : command.input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw failure(400, 'Batch size must be 1–100');
  return execute({ ...command, action: 'cards.batch_issued' }, async ({ session, edition }) => {
    editable(edition);
    if (!edition.cardSettings) throw fail('card_confirmation_required');
    const settings = edition.cardSettings;
    validateVariant(settings);
    if (!eligibleReport(await reconciliation(edition, session))) throw fail('reconciliation_incomplete');
    const participants = await M.Participant.find({ editionId: edition._id, active: true })
      .select('_id sourceRowId')
      .sort({ _id: 1 })
      .session(session);
    const existing = await M.Card.find({ editionId: edition._id }).session(session);
    const artifacts = await M.CardPdf.find({ editionId: edition._id })
      .select('cardId sha256')
      .session(session);
    const activeIds = new Set(participants.map((p) => p.id));
    const existingIds = new Set(existing.map((c) => c.id));
    const byPerson = new Map(existing.map((card) => [String(card.participantId), card]));
    const byCard = new Map(artifacts.map((pdf) => [String(pdf.cardId), pdf]));
    const used = new Set(existing.map((card) => card.layoutHash));
    const pending = participants.filter((p) => {
      const card = byPerson.get(p.id),
        artifact = card && byCard.get(card.id);
      return !card || !artifact || !card.pdf || !card.pdf.sha256;
    });
    // A wrong digest is an incident, not a reason to replace a card or its PDF silently.
    for (const card of existing.filter((c) => activeIds.has(String(c.participantId)))) {
      const artifact = byCard.get(card.id);
      if (
        card.layoutHash !== fingerprint(card.cells) ||
        !matchesVariant(card.cells, settings) ||
        (artifact && (!card.pdf || card.pdf.sha256 !== artifact.sha256))
      )
        throw fail('pdf_integrity');
    }
    let created = 0,
      recovered = 0;
    for (const participant of pending.slice(0, limit)) {
      let card = byPerson.get(participant.id);
      if (!card) {
        const cells = uniqueCells(settings, used, dependencies.generate);
        const [saved] = await M.Card.create(
          [
            {
              ...cardRecord({
                editionId: edition._id,
                participantId: participant._id,
                sourceRowId: participant.sourceRowId,
                cells
              }),
              generation: { ...variant(settings), settingsVersion: settings.version },
              presentation: {
                title: settings.title,
                editionId: edition.id,
                eventDate: settings.eventDate,
                eventTime: settings.eventTime,
                timeZone: settings.timeZone,
                templateVersion: TEMPLATE_VERSION,
                issuedAt: new Date().toISOString()
              }
            }
          ],
          { session }
        );
        card = saved;
        created++;
      } else if (!card.presentation || !card.generation) {
        throw fail('card_legacy');
      }
      if (byCard.has(card.id)) throw fail('pdf_integrity');
      await storePdf(card, session, dependencies.render);
      if (!byPerson.has(participant.id)) byPerson.set(participant.id, card);
      else recovered++;
      await audit(session, {
        editionId: edition._id,
        actorId: command.actorId,
        action: !existingIds.has(card.id) ? 'card.issued' : 'card.pdf_recovered',
        resourceId: card._id,
        version: edition.version
      });
    }
    if (participants.length && !edition.cardSettingsLockedAt) {
      edition.cardSettingsLockedAt = new Date();
      await edition.save({ session });
    }
    return {
      version: edition.version,
      processed: Math.min(limit, pending.length),
      created,
      recovered,
      remaining: Math.max(0, pending.length - limit),
      totalParticipants: participants.length
    };
  });
}
async function cardFor(editionId, cardId, session) {
  if (!mongoose.isValidObjectId(cardId)) throw failure(400, 'Invalid card identifier');
  const card = await M.Card.findOne({ _id: cardId, editionId }).session(session);
  if (!card) throw failure(404, 'Card not found');
  return card;
}
async function recoverPdf(command) {
  return execute({ ...command, action: 'card.pdf_recovered' }, async ({ session, edition }) => {
    const card = await cardFor(edition._id, command.input.cardId, session);
    if (!card.presentation || !card.generation) throw fail('pdf_missing');
    const artifact = await M.CardPdf.findOne({ cardId: card._id, editionId: edition._id })
      .select('+bytes')
      .session(session);
    if (artifact) {
      if (sha256(artifact.bytes) !== artifact.sha256 || !card.pdf || artifact.sha256 !== card.pdf.sha256)
        throw fail('pdf_integrity');
      return { cardId: card.id, version: edition.version, recovered: false };
    }
    await storePdf(card, session);
    return { cardId: card.id, version: edition.version, recovered: true };
  });
}
async function rerenderPdf(card, session) {
  card.presentation = { ...card.presentation, templateVersion: TEMPLATE_VERSION };
  const bytes = await renderCardPdf(card);
  const digest = sha256(bytes);
  await M.CardPdf.deleteOne({ cardId: card._id, editionId: card.editionId }).session(session);
  const [pdf] = await M.CardPdf.create(
    [{ editionId: card.editionId, cardId: card._id, bytes, sha256: digest, templateVersion: TEMPLATE_VERSION }],
    { session }
  );
  card.pdf = { storageKey: `mongodb:pilotcardpdfs:${pdf.id}`, sha256: digest };
  await card.save({ session });
}
async function reissuePdf(command) {
  return execute({ ...command, action: 'card.pdf_reissued' }, async ({ session, edition }) => {
    const card = await cardFor(edition._id, command.input.cardId, session);
    if (!card.presentation || !card.generation) throw fail('card_legacy');
    if (card.presentation.templateVersion === TEMPLATE_VERSION)
      return { cardId: card.id, version: edition.version, updated: false };
    await rerenderPdf(card, session);
    return { cardId: card.id, version: edition.version, updated: true };
  });
}
async function reissueBatch(command) {
  const limit = command.input.limit === undefined ? 50 : command.input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw failure(400, 'Batch size must be 1–100');
  return execute({ ...command, action: 'cards.batch_pdf_reissued' }, async ({ session, edition }) => {
    const outdated = await M.Card.find({
      editionId: edition._id,
      presentation: { $exists: true },
      generation: { $exists: true },
      'presentation.templateVersion': { $ne: TEMPLATE_VERSION }
    })
      .sort({ _id: 1 })
      .limit(limit)
      .session(session);
    for (const card of outdated) await rerenderPdf(card, session);
    const remaining = await M.Card.countDocuments({
      editionId: edition._id,
      presentation: { $exists: true },
      generation: { $exists: true },
      'presentation.templateVersion': { $ne: TEMPLATE_VERSION }
    }).session(session);
    return { version: edition.version, updated: outdated.length, remaining };
  });
}
async function readPdf(editionId, cardId, actorId) {
  const card = await cardFor(editionId, cardId);
  const artifact = await M.CardPdf.findOne({ editionId, cardId: card._id }).select('+bytes');
  if (!artifact) throw fail('pdf_missing');
  if (!card.pdf || sha256(artifact.bytes) !== artifact.sha256 || artifact.sha256 !== card.pdf.sha256)
    throw fail('pdf_integrity');
  await audit(null, { editionId, actorId, action: 'card.pdf_downloaded', resourceId: card._id });
  return { bytes: artifact.bytes, sha256: artifact.sha256, cardCode: card.cardCode };
}
async function summary(editionId) {
  const edition = await M.Edition.findById(editionId);
  if (!edition) throw failure(404, 'Edition not found');
  const report = await reconciliation(edition);
  const cards = await M.Card.find({
    editionId,
    participantId: {
      $in: [
        ...new Set((await M.Participant.find({ editionId, active: true }).select('_id')).map((p) => p._id))
      ]
    }
  }).select('_id pdf');
  const pdfs = await M.CardPdf.find({ cardId: { $in: cards.map((c) => c._id) }, editionId }).select(
    'cardId sha256'
  );
  const byCard = new Map(pdfs.map((pdf) => [String(pdf.cardId), pdf.sha256]));
  const pdfReady = cards.filter((c) => c.pdf && byCard.get(c.id) === c.pdf.sha256).length;
  const outdatedTemplates = await M.Card.countDocuments({
    editionId,
    presentation: { $exists: true },
    generation: { $exists: true },
    'presentation.templateVersion': { $ne: TEMPLATE_VERSION }
  });
  const settings = edition.cardSettings;
  return {
    version: edition.version,
    settings: settings
      ? {
          ...variant(settings),
          title: settings.title,
          eventDate: settings.eventDate,
          eventTime: settings.eventTime,
          timeZone: settings.timeZone,
          confirmedAt: settings.confirmedAt
        }
      : null,
    locked: Boolean(edition.cardSettingsLockedAt),
    listClosed: Boolean(edition.listClosedAt),
    eligible: Boolean(eligibleReport(report) && edition.state === 'preparation' && !edition.listClosedAt),
    activeParticipants: report.activeParticipants,
    issuedCards: cards.length,
    pdfReady,
    remaining: report.activeParticipants - pdfReady,
    outdatedTemplates
  };
}
module.exports = {
  configureCards,
  issueBatch,
  recoverPdf,
  reissuePdf,
  reissueBatch,
  readPdf,
  summary,
  sha256
};
