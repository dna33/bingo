const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/async-handler');
const { permit } = require('./auth');
const { audit } = require('./commands');
const M = require('./models');
const game = require('./game');
const contacts = require('./contacts');
const registry = require('./provider-registry');
const failure = require('./errors');
const router = express.Router({ mergeParams: true });
router.use(permit('participants:read'));
router.use(
  asyncHandler(async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.editionId)) throw failure(400, 'Invalid edition');
    if (!(await M.Edition.exists({ _id: req.params.editionId }))) throw failure(404, 'Edition not found');
    next();
  })
);
function pagination(req) {
  const limit = req.query.limit === undefined ? 25 : Number(req.query.limit),
    offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
    throw failure(400, 'Invalid pagination');
  return { limit, offset };
}
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    let snapshot;
    try {
      await session.withTransaction(async () => {
        const edition = await M.Edition.findById(req.params.editionId).session(session).lean();
        const config = edition.gameConfigurationId
          ? await M.GameConfiguration.findById(edition.gameConfigurationId).session(session).lean()
          : null;
        const round = edition.currentRoundId
          ? await M.Round.findById(edition.currentRoundId).session(session).lean()
          : null;
        const draws = round
          ? await M.Draw.find({ roundId: round._id })
              .select('_id number sequence drawnAt origin evaluationComplete evaluatedCards candidateCount')
              .sort({ sequence: 1 })
              .session(session)
              .lean()
          : [];
        const results = round
          ? await M.FigureResult.find({ roundId: round._id }).session(session).lean()
          : [];
        const pending = await M.Candidate.countDocuments({
          editionId: edition._id,
          cohort: 'primary',
          state: { $in: ['detected', 'contacting', 'awaiting_response'] }
        }).session(session);
        snapshot = {
          id: edition._id,
          name: edition.name,
          version: edition.version,
          state: edition.state,
          rules: config ? config.rules : null,
          rulesVersion: config ? config.version : null,
          round,
          draws,
          results,
          pendingPrimaryCandidates: pending,
          rounds: await M.Round.find({ editionId: edition._id })
            .select('_id ordinal figures state lastSequence')
            .sort({ ordinal: 1 })
            .session(session)
            .lean(),
          rosterCount: await M.GameRoster.countDocuments({ editionId: edition._id }).session(session),
          incidentCount: await M.GameIncident.countDocuments({ editionId: edition._id }).session(session),
          serverTime: new Date().toISOString()
        };
      });
      res.json(snapshot);
    } finally {
      await session.endSession();
    }
  })
);
router.get(
  '/configurations',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pagination(req);
    res.json(
      await M.GameConfiguration.find({ editionId: req.params.editionId })
        .select('_id version rules confirmedAt confirmedBy')
        .sort({ version: 1 })
        .skip(offset)
        .limit(limit)
        .lean()
    );
  })
);
router.get(
  '/candidates',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pagination(req),
      filter = { editionId: req.params.editionId };
    if (req.query.roundId) {
      if (
        !mongoose.isValidObjectId(req.query.roundId) ||
        !(await M.Round.exists({ _id: req.query.roundId, editionId: req.params.editionId }))
      )
        throw failure(404, 'Round not found');
      filter.roundId = req.query.roundId;
    }
    if (req.query.figure) {
      if (!['F', 'A', 'B', 'U', 'L', 'S', 'O'].includes(req.query.figure))
        throw failure(400, 'Invalid figure');
      filter.figure = req.query.figure;
    }
    if (req.query.cohort) {
      if (!['primary', 'reserve'].includes(req.query.cohort)) throw failure(400, 'Invalid cohort');
      filter.cohort = req.query.cohort;
    }
    const rows = await M.Candidate.find(filter)
      .select(
        '_id participantId cardId roundId drawId figure maskVersion cohort state evidence createdAt contactStartedAt expiresAt responseReceivedAt resolution resolvedAt'
      )
      .sort({ createdAt: 1, _id: 1 })
      .skip(offset)
      .limit(limit)
      .lean();
    res.json(rows.map((row) => contacts.publicStatus(row)));
  })
);
router.get(
  '/candidates/:candidateId/contact',
  permit('contacts:read'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.candidateId)) throw failure(400, 'Invalid candidate');
    const candidate = await M.Candidate.findOne({
      _id: req.params.candidateId,
      editionId: req.params.editionId
    }).select('+recipient');
    if (!candidate) throw failure(404, 'Candidate not found');
    const person = await M.Participant.findOne({
      _id: candidate.participantId,
      editionId: req.params.editionId
    }).select('_id name +emails +phones');
    if (!person) throw failure(404, 'Participant not found');
    const deliveries = await M.Delivery.find({
      editionId: req.params.editionId,
      participantId: person._id,
      cardId: candidate.cardId
    })
      .select('_id kind parentId channel recipient state createdAt acceptedAt')
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'candidate.contact_viewed',
      resourceId: candidate._id
    });
    res.json({
      candidateId: candidate._id,
      figure: candidate.figure,
      participantId: person._id,
      name: person.name,
      emails: person.emails,
      phones: person.phones,
      deliveries,
      workflow: contacts.publicStatus(candidate.toObject()),
      events: await M.ContactEvent.find({ editionId: req.params.editionId, candidateId: candidate._id })
        .select('+evidence +recipient')
        .sort({ occurredAt: -1, _id: -1 })
        .limit(200)
        .lean(),
      serverTime: new Date().toISOString(),
      providers: registry.status()
    });
  })
);
router.get(
  '/incidents',
  asyncHandler(async (req, res) => {
    if (!req.staff.permissions.has('game:operate') && !req.staff.permissions.has('audit:read'))
      throw failure(403, 'Insufficient permission');
    const { limit, offset } = pagination(req);
    const rows = await M.GameIncident.find({ editionId: req.params.editionId })
      .select('_id kind reason roundId drawId operatorId occurredAt')
      .sort({ occurredAt: 1 })
      .skip(offset)
      .limit(limit)
      .lean();
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'game.incidents_viewed',
      resourceId: req.params.editionId
    });
    res.json(rows);
  })
);
router.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pagination(req);
    const filter = { editionId: req.params.editionId };
    if (req.query.pending === 'true') filter.acknowledgedAt = { $exists: false };
    const session = await mongoose.startSession();
    let snapshot;
    try {
      await session.withTransaction(
        async () => {
          const edition = await M.Edition.findById(req.params.editionId).select('version').session(session);
          if (!edition) throw failure(404, 'Edition not found');
          const rows = await M.CandidateAlert.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .skip(offset)
            .limit(limit)
            .session(session)
            .lean();
          const pendingCount = await M.CandidateAlert.countDocuments({
            editionId: req.params.editionId,
            acknowledgedAt: { $exists: false }
          }).session(session);
          snapshot = { rows, pendingCount, version: edition.version, serverTime: new Date().toISOString() };
        },
        { readConcern: { level: 'snapshot' } }
      );
      res.set('Cache-Control', 'private, no-store').json(snapshot);
    } finally {
      await session.endSession();
    }
  })
);
for (const [action, permission, work] of [
  ['begin', 'game:operate', contacts.begin],
  ['notice', 'game:operate', contacts.notice],
  ['respond', 'results:confirm', contacts.respond],
  ['discard', 'results:confirm', contacts.discard]
])
  router.post(
    `/candidates/:candidateId/${action}`,
    permit(permission),
    permit('contacts:read'),
    asyncHandler(async (req, res) => {
      const { channel, evidence, success, receivedAt, reviewedNoTimelyResponse } = req.body;
      res.json(
        await work({
          editionId: req.params.editionId,
          actorId: req.staff.id,
          key: req.get('Idempotency-Key'),
          expectedVersion: req.body.expectedVersion,
          input: {
            candidateId: req.params.candidateId,
            channel,
            evidence,
            success,
            receivedAt,
            reviewedNoTimelyResponse
          }
        })
      );
    })
  );
router.post(
  '/alerts/:alertId/acknowledge',
  permit('game:operate'),
  asyncHandler(async (req, res) => {
    res.json(
      await contacts.acknowledge({
        editionId: req.params.editionId,
        actorId: req.staff.id,
        key: req.get('Idempotency-Key'),
        expectedVersion: req.body.expectedVersion,
        input: { alertId: req.params.alertId }
      })
    );
  })
);
const actions = {
  'alerts/reconcile': ['game:operate', contacts.reconcileAlerts],
  configure: ['editions:configure', game.configure],
  prepare: ['game:operate', game.prepare],
  start: ['game:operate', game.start],
  pause: ['game:operate', game.pause],
  resume: ['game:operate', game.resume],
  draw: ['game:operate', game.draw],
  'next-round': ['game:operate', game.nextRound],
  incidents: ['game:operate', game.incident],
  finish: ['game:operate', game.finish]
};
for (const [path, [permission, work]] of Object.entries(actions))
  router.post(
    `/${path}`,
    permit(permission),
    asyncHandler(async (req, res) => {
      res.json(
        await work({
          editionId: req.params.editionId,
          actorId: req.staff.id,
          key: req.get('Idempotency-Key'),
          expectedVersion: req.body.expectedVersion,
          input: {
            settings: req.body.settings,
            number: req.body.number,
            roundId: req.body.roundId,
            reason: req.body.reason,
            kind: req.body.kind,
            drawId: req.body.drawId
          }
        })
      );
    })
  );
module.exports = router;
