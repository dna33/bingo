const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/async-handler');
const { permit } = require('./auth');
const { audit } = require('./commands');
const M = require('./models');
const P = require('./prizes');
const reports = require('./prize-reports');
const failure = require('./errors');
const router = express.Router({ mergeParams: true });
router.use(permit('participants:read'));
router.use(
  asyncHandler(async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.editionId)) throw failure(400, 'Invalid edition');
    if (!(await M.Edition.exists({ _id: req.params.editionId }))) throw failure(404, 'Edition not found');
    res.set('Cache-Control', 'private, no-store');
    next();
  })
);
const financialRead = (req, res, next) =>
  req.staff.permissions.has('results:confirm') || req.staff.permissions.has('exports:read')
    ? next()
    : next(failure(403, 'Insufficient permission'));
router.get(
  '/',
  asyncHandler(async (req, res) => res.json(await reports.summary(req.params.editionId)))
);
router.get(
  '/accounts/:participantId',
  financialRead,
  permit('contacts:read'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.participantId)) throw failure(400, 'Invalid participant');
    const person = await M.Participant.findOne({
      _id: req.params.participantId,
      editionId: req.params.editionId
    }).select('+name +emails +phones');
    if (!person) throw failure(404, 'Participant not found');
    const account = await M.PollaAccount.findOne({
      participantId: person._id,
      editionId: req.params.editionId
    }).select('+accountReference +verificationEvidence');
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'prize.account_viewed',
      resourceId: person._id
    });
    res.json({ participant: person, account });
  })
);
router.get(
  '/proposals/:proposalId',
  financialRead,
  permit('contacts:read'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.proposalId)) throw failure(400, 'Invalid proposal');
    const proposal = await M.PrizeProposal.findOne({
      _id: req.params.proposalId,
      editionId: req.params.editionId
    })
      .select('+basis +accounts +reason')
      .lean();
    if (!proposal) throw failure(404, 'Proposal not found');
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'prize.proposal_viewed',
      resourceId: proposal._id
    });
    res.json(proposal);
  })
);
router.get(
  '/reports/:kind',
  financialRead,
  permit('contacts:read'),
  asyncHandler(async (req, res) => {
    const exported = req.query.format === 'csv';
    if (exported && !req.staff.permissions.has('exports:read')) throw failure(403, 'Insufficient permission');
    const report = await reports.report(req.params.editionId, req.params.kind, {
      ...req.query,
      all: exported
    });
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: exported ? 'prize.report_exported' : 'prize.report_viewed',
      resourceId: req.params.editionId,
      version: report.version
    });
    if (!exported) return res.json(report);
    res.set('Content-Disposition', `attachment; filename="premios-${req.params.kind}.csv"`);
    res.type('text/csv; charset=utf-8').send(reports.csv(report.rows));
  })
);
for (const [path, work] of Object.entries({
  accounts: P.verifyAccount,
  prepare: P.prepare,
  confirm: P.confirm,
  credits: P.credit,
  'reopen-round': P.reopenRound
}))
  router.post(
    '/' + path,
    permit('results:confirm'),
    permit('contacts:read'),
    asyncHandler(async (req, res) => {
      const {
        participantId,
        accountReference,
        evidence,
        verifiedWithPolla,
        resultId,
        proposalId,
        reviewed,
        reviewedSnapshotHash,
        exhaustionAcknowledged,
        reason,
        awardId,
        amountClp,
        reference,
        creditedAt,
        creditedToPolla
      } = req.body;
      res.json(
        await work({
          editionId: req.params.editionId,
          actorId: req.staff.id,
          key: req.get('Idempotency-Key'),
          expectedVersion: req.body.expectedVersion,
          input: {
            participantId,
            accountReference,
            evidence,
            verifiedWithPolla,
            resultId,
            proposalId,
            reviewed,
            reviewedSnapshotHash,
            exhaustionAcknowledged,
            reason,
            awardId,
            amountClp,
            reference,
            creditedAt,
            creditedToPolla
          }
        })
      );
    })
  );
module.exports = router;
