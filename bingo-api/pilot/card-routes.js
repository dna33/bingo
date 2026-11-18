const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/async-handler');
const { permit } = require('./auth');
const { Edition } = require('./models');
const service = require('./cards');
const failure = require('./errors');
const router = express.Router({ mergeParams: true });
router.use((req, res, next) => {
  if (!/^\/(card-settings$|cards\/(?:summary$|issue$|[^/]+\/pdf(?:\/recover)?$))/.test(req.path))
    return next('router');
  next();
});
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
  input: { settings: req.body.settings, limit: req.body.limit, cardId: req.params.cardId }
});
router.get(
  '/cards/summary',
  permit('participants:read'),
  asyncHandler(async (req, res) => res.json(await service.summary(req.params.editionId)))
);
router.post(
  '/card-settings',
  permit('editions:configure'),
  asyncHandler(async (req, res) => res.json(await service.configureCards(command(req))))
);
router.post(
  '/cards/issue',
  permit('cards:issue'),
  asyncHandler(async (req, res) => res.json(await service.issueBatch(command(req))))
);
router.get(
  '/cards/:cardId/pdf',
  permit('participants:read'),
  asyncHandler(async (req, res) => {
    const pdf = await service.readPdf(req.params.editionId, req.params.cardId, req.staff.id);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `attachment; filename="carton-${req.params.cardId}.pdf"`);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-PDF-SHA256', pdf.sha256);
    res.type('application/pdf').send(pdf.bytes);
  })
);
router.post(
  '/cards/:cardId/pdf/recover',
  permit('cards:issue'),
  asyncHandler(async (req, res) => res.json(await service.recoverPdf(command(req))))
);
module.exports = router;
