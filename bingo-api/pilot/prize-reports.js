const mongoose = require('mongoose');
const M = require('./models');
const { names, pools } = require('./game-engine');
const P = require('./prizes');
const failure = require('./errors');
const sid = (v) => String(v);
async function snapshot(editionId, work) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(
      async () => {
        const edition = await M.Edition.findById(editionId).session(session).lean();
        if (!edition) throw failure(404, 'Edition not found');
        result = await work(edition, session);
      },
      { readConcern: { level: 'snapshot' } }
    );
    return result;
  } finally {
    await session.endSession();
  }
}
async function budget(edition, session) {
  const initialized = Boolean(await M.PrizePool.exists({ editionId: edition._id }).session(session));
  if (!initialized && (await M.Award.exists({ editionId: edition._id }).session(session)))
    throw Object.assign(failure(409, 'Legacy awards require reconciliation'), { publicCode: 'prize_legacy' });
  const ledger = initialized
    ? await P.checkBudget(edition._id, session)
    : names.map((figure) => ({
        figure,
        totalClp: pools[figure],
        allocatedClp: 0,
        deliveredClp: 0,
        unassignedClp: 0,
        availableClp: pools[figure],
        pendingCreditClp: 0
      }));
  const totals = {
    totalClp: 400000,
    allocatedClp: 0,
    deliveredClp: 0,
    unassignedClp: 0,
    availableClp: 0,
    pendingCreditClp: 0
  };
  for (const pool of ledger)
    for (const key of Object.keys(totals)) if (key !== 'totalClp') totals[key] += pool[key];
  return { initialized, totals, pools: ledger };
}
async function summary(editionId) {
  return snapshot(editionId, async (edition, session) => ({
    version: edition.version,
    state: edition.state,
    currentRoundId: edition.currentRoundId,
    ...(await budget(edition, session)),
    results: await M.FigureResult.find({ editionId }).sort({ createdAt: 1 }).session(session).lean(),
    proposals: await M.PrizeProposal.find({ editionId })
      .select('-split')
      .sort({ createdAt: 1 })
      .session(session)
      .lean(),
    settlements: await M.PrizeSettlement.find({ editionId })
      .select('-reason')
      .sort({ createdAt: 1 })
      .session(session)
      .lean(),
    serverTime: new Date().toISOString()
  }));
}
function filter(input, editionId) {
  const result = { editionId };
  if (input.figure) {
    if (!names.includes(input.figure)) throw failure(400, 'Invalid figure');
    result.figure = input.figure;
  }
  return result;
}
async function report(editionId, kind, input = {}) {
  if (!['confirmed', 'discarded', 'awards', 'pending', 'delivered'].includes(kind))
    throw failure(400, 'Invalid report kind');
  const limit = input.limit === undefined ? 25 : Number(input.limit),
    offset = input.offset === undefined ? 0 : Number(input.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
    throw failure(400, 'Invalid pagination');
  return snapshot(editionId, async (edition, session) => {
    const candidateFilter = filter(input, editionId);
    let awardFilter = filter(input, editionId),
      awards;
    if (kind === 'pending') awardFilter.state = 'confirmed';
    if (kind === 'delivered') awardFilter.state = 'delivered';
    if (['awards', 'pending', 'delivered'].includes(kind)) {
      awards = await M.Award.find(awardFilter).select('+accountReference').session(session).lean();
      candidateFilter._id = { $in: awards.map((a) => a.candidateId) };
    } else candidateFilter.state = kind === 'discarded' ? 'discarded' : { $in: ['confirmed', 'delivered'] };
    const total = await M.Candidate.countDocuments(candidateFilter).session(session);
    if (input.all && total > 100000)
      throw failure(413, 'Filter report by figure; export exceeds 100000 rows');
    const candidates = await M.Candidate.find(candidateFilter)
      .select('+recipient +responseEvidence')
      .sort({ figure: 1, roundId: 1, allocationCycle: 1, _id: 1 })
      .skip(input.all ? 0 : offset)
      .limit(input.all ? 100000 : limit)
      .session(session)
      .lean();
    if (!awards)
      awards = await M.Award.find({ editionId, candidateId: { $in: candidates.map((c) => c._id) } })
        .select('+accountReference')
        .session(session)
        .lean();
    const people = await M.Participant.find({
      editionId,
      _id: { $in: candidates.map((c) => c.participantId) }
    })
      .select('+name +emails +phones')
      .session(session)
      .lean();
    const cards = await M.Card.find({ editionId, _id: { $in: candidates.map((c) => c.cardId) } })
      .session(session)
      .lean();
    const accounts = await M.PollaAccount.find({
      editionId,
      participantId: { $in: candidates.map((c) => c.participantId) }
    })
      .select('+accountReference +verificationEvidence')
      .session(session)
      .lean();
    const credits = await M.PrizeCredit.find({ editionId, awardId: { $in: awards.map((a) => a._id) } })
      .select('+accountReference +reference +evidence')
      .session(session)
      .lean();
    const deliveries = await M.Delivery.find({ editionId, cardId: { $in: candidates.map((c) => c.cardId) } })
      .select('_id participantId cardId channel +recipient state parentId')
      .session(session)
      .lean();
    const events = await M.ContactEvent.find({
      editionId,
      candidateId: { $in: candidates.map((c) => c._id) }
    })
      .select('+evidence +recipient')
      .sort({ occurredAt: 1, _id: 1 })
      .session(session)
      .lean();
    const peopleById = new Map(people.map((p) => [sid(p._id), p])),
      cardsById = new Map(cards.map((c) => [sid(c._id), c])),
      awardsByCandidate = new Map(awards.map((a) => [sid(a.candidateId), a])),
      accountsByPerson = new Map(accounts.map((a) => [sid(a.participantId), a])),
      creditsByAward = new Map(credits.map((c) => [sid(c.awardId), c]));
    const eventsByCandidate = new Map(),
      deliveriesByCard = new Map();
    for (const event of events) {
      const key = sid(event.candidateId),
        group = eventsByCandidate.get(key) || [];
      group.push(event);
      eventsByCandidate.set(key, group);
    }
    for (const delivery of deliveries) {
      const key = sid(delivery.cardId) + ':' + sid(delivery.participantId),
        group = deliveriesByCard.get(key) || [];
      group.push(delivery);
      deliveriesByCard.set(key, group);
    }
    const rows = candidates.map((c) => {
      const person = peopleById.get(sid(c.participantId)),
        card = cardsById.get(sid(c.cardId)),
        award = awardsByCandidate.get(sid(c._id)),
        account = accountsByPerson.get(sid(c.participantId)),
        credit = award && creditsByAward.get(sid(award._id));
      return {
        editionId: sid(edition._id),
        editionVersion: edition.version,
        candidateId: sid(c._id),
        participantId: sid(c.participantId),
        sourceRowId: card ? sid(card.sourceRowId) : '',
        externalId: person ? person.externalId || '' : '',
        name: person ? person.name || '' : '',
        email: person ? (person.emails || []).join('; ') : '',
        phone: person ? (person.phones || []).join('; ') : '',
        cardId: sid(c.cardId),
        cardCode: card ? card.cardCode : '',
        roundId: sid(c.roundId),
        figure: c.figure,
        cycle: c.allocationCycle || 0,
        candidateState: c.state,
        awardId: award ? sid(award._id) : '',
        awardState: award
          ? award.state
          : c.state === 'discarded'
            ? 'not_eligible'
            : c.settledAt
              ? 'no_credit_due'
              : 'not_allocated',
        amountClp: award ? award.amountClp : c.settledAt ? c.allocatedClp : null,
        accountReference: award ? award.accountReference : account ? account.accountReference : '',
        destination: 'polla.cl',
        accountVerifiedAt: account ? account.verifiedAt : null,
        accountVerifiedBy: account ? account.verifiedBy : null,
        accountVerificationEvidence: account ? account.verificationEvidence : '',
        contactEvents: eventsByCandidate.get(sid(c._id)) || [],
        contactStartedAt: c.contactStartedAt || null,
        expiresAt: c.expiresAt || null,
        responseReceivedAt: c.responseReceivedAt || null,
        contactChannel: c.channel || '',
        contactRecipient: c.recipient || '',
        resolution: c.resolution || '',
        responseEvidence: c.responseEvidence || '',
        evidence: c.evidence,
        deliveries: deliveriesByCard.get(sid(c.cardId) + ':' + sid(c.participantId)) || [],
        creditedAt: credit ? credit.creditedAt : null,
        creditReference: credit ? credit.reference : '',
        creditEvidence: credit ? credit.evidence : ''
      };
    });
    return {
      version: edition.version,
      kind,
      total,
      limit: input.all ? total : limit,
      offset: input.all ? 0 : offset,
      budget: await budget(edition, session),
      serverTime: new Date().toISOString(),
      rows
    };
  });
}
const columns = [
  'editionId',
  'editionVersion',
  'candidateId',
  'participantId',
  'sourceRowId',
  'externalId',
  'name',
  'email',
  'phone',
  'cardId',
  'cardCode',
  'roundId',
  'figure',
  'cycle',
  'candidateState',
  'awardId',
  'awardState',
  'amountClp',
  'destination',
  'accountReference',
  'accountVerifiedAt',
  'accountVerifiedBy',
  'accountVerificationEvidence',
  'contactEvents',
  'contactStartedAt',
  'expiresAt',
  'responseReceivedAt',
  'contactChannel',
  'contactRecipient',
  'resolution',
  'responseEvidence',
  'evidence',
  'deliveries',
  'creditedAt',
  'creditReference',
  'creditEvidence'
];
function csvCell(value) {
  let text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  if (/^\s*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
const csv = (rows) =>
  '\uFEFF' +
  [columns, ...rows.map((row) => columns.map((key) => row[key]))]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n') +
  '\r\n';
module.exports = { summary, report, csv, snapshot };
