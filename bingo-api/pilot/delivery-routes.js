const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/async-handler');
const { permit } = require('./auth');
const { Edition, Delivery, Participant, SendAttempt } = require('./models');
const { audit } = require('./commands');
const service = require('./deliveries');
const registry = require('./provider-registry');
const failure = require('./errors');
const router = express.Router({ mergeParams: true });
router.use(permit('deliveries:read'), permit('contacts:read'));
router.use(
  asyncHandler(async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.editionId)) throw failure(400, 'Invalid edition');
    if (!(await Edition.exists({ _id: req.params.editionId }))) throw failure(404, 'Edition not found');
    next();
  })
);
const command = (req) => ({
  editionId: req.params.editionId,
  actorId: req.staff.id,
  key: req.get('Idempotency-Key'),
  expectedVersion: req.body.expectedVersion,
  input: { ...req.body, jobId: req.params.jobId }
});
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const editionId = new mongoose.Types.ObjectId(req.params.editionId);
    const groups = await Delivery.aggregate([
      { $match: { editionId } },
      { $group: { _id: '$state', count: { $sum: 1 } } }
    ]);
    const counts = Object.fromEntries(groups.map((group) => [group._id, group.count]));
    const active = await Participant.countDocuments({ editionId, active: true });
    const initial = await Delivery.countDocuments({ editionId, kind: 'initial' });
    res.json({
      providers: registry.status(),
      counts,
      activeParticipants: active,
      initialQueued: initial,
      unqueued: Math.max(0, active - initial),
      version: (await Edition.findById(editionId)).version,
      leaseMs: service.LEASE_MS,
      spacingMs: service.SPACING_MS
    });
  })
);
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit),
      offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    const states = [
      'pending',
      'processing',
      'uncertain',
      'provider_accepted',
      'delivered',
      'bounced',
      'failed'
    ];
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      (req.query.state && !states.includes(req.query.state))
    )
      throw failure(400, 'Invalid pagination or filter');
    const rows = await Delivery.find({
      editionId: req.params.editionId,
      ...(req.query.state ? { state: req.query.state } : {})
    })
      .select('+recipient')
      .sort({ _id: 1 })
      .skip(offset)
      .limit(limit)
      .lean();
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'deliveries.viewed',
      resourceId: req.params.editionId
    });
    res.json(
      rows.map((job) => ({
        _id: job._id,
        participantId: job.participantId,
        cardId: job.cardId,
        kind: job.kind,
        parentId: job.parentId,
        channel: job.channel,
        recipient: job.recipient,
        state: job.state,
        simulation: job.simulation,
        attemptCount: job.attemptCount,
        pdfSha256: job.pdfSha256,
        errorCode: job.errorCode,
        providerKey: job.providerKey,
        nextAttemptAt: job.nextAttemptAt,
        createdAt: job.createdAt,
        acceptedAt: job.acceptedAt,
        deliveredAt: job.deliveredAt,
        bouncedAt: job.bouncedAt
      }))
    );
  })
);
router.get(
  '/:jobId/attempts',
  asyncHandler(async (req, res) => {
    if (
      !mongoose.isValidObjectId(req.params.jobId) ||
      !(await Delivery.exists({ _id: req.params.jobId, editionId: req.params.editionId }))
    )
      throw failure(404, 'Delivery not found');
    const attempts = await SendAttempt.find({ jobId: req.params.jobId, editionId: req.params.editionId })
      .select(
        'attempt channel recipient state attemptedAt completedAt retryable errorCode pdfSha256 providerReference'
      )
      .sort({ attempt: 1 })
      .lean();
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'delivery.attempts_viewed',
      resourceId: req.params.jobId
    });
    res.json(attempts);
  })
);
router.get(
  '/:jobId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.jobId)) throw failure(400, 'Invalid identifier');
    const job = await Delivery.findOne({ _id: req.params.jobId, editionId: req.params.editionId })
      .select('+reason +retryHistory')
      .lean();
    if (!job) throw failure(404, 'Delivery not found');
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'delivery.detail_viewed',
      resourceId: job._id
    });
    res.json({
      id: job._id,
      sourceRowId: job.sourceRowId,
      parentId: job.parentId,
      reason: job.reason,
      retryHistory: job.retryHistory
    });
  })
);
router.post(
  '/enqueue',
  permit('deliveries:manage'),
  asyncHandler(async (req, res) => res.json(await service.enqueue(command(req))))
);
router.post(
  '/process',
  permit('deliveries:manage'),
  asyncHandler(async (req, res) => {
    // Worker-side transactions and leases protect repeated requests; no external side effect in execute().
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'deliveries.processing_requested',
      resourceId: req.params.editionId
    });
    res.json(
      await service.processBatch(req.params.editionId, {
        limit: req.body.limit === undefined ? 25 : req.body.limit
      })
    );
  })
);
router.post(
  '/:jobId/retry',
  permit('deliveries:manage'),
  asyncHandler(async (req, res) => res.json(await service.retry(command(req))))
);
router.post(
  '/:jobId/resend',
  permit('deliveries:manage'),
  asyncHandler(async (req, res) => res.json(await service.resend(command(req))))
);
router.post(
  '/:jobId/reconcile',
  permit('deliveries:manage'),
  asyncHandler(async (req, res) => {
    if (
      !mongoose.isValidObjectId(req.params.jobId) ||
      !(await Delivery.exists({ _id: req.params.jobId, editionId: req.params.editionId }))
    )
      throw failure(404, 'Delivery not found');
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'delivery.reconciliation_requested',
      resourceId: req.params.jobId
    });
    res.json(await service.reconcile(req.params.editionId, req.params.jobId));
  })
);
router.post(
  '/:jobId/mock-event',
  permit('deliveries:manage'),
  asyncHandler(async (req, res) => res.json(await service.mockEvent(command(req))))
);
module.exports = router;
