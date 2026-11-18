const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/async-handler');
const { staff, permit } = require('./auth');
const { Edition, ConfigVersion, Participant, Audit, Card, CardPdf } = require('./models');
const { createEdition, configureEdition } = require('./persistence');
const { audit } = require('./commands');
const failure = require('./errors');
const router = express.Router();
router.use(staff);
router.use('/editions/:editionId/prizes', require('./prize-routes'));
router.use('/editions/:editionId/game', require('./game-routes'));
router.use('/editions/:editionId/deliveries', require('./delivery-routes'));
router.use('/editions/:editionId', require('./card-routes'));
router.use('/editions/:editionId', require('./import-routes'));
router.get('/me', (req, res) => res.json({ id: req.staff.id, permissions: [...req.staff.permissions] }));
function objectId(value) {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) throw failure(400, 'Invalid identifier');
  return value;
}
function page(req) {
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw failure(400, 'Invalid pagination');
  return { limit, offset };
}
async function requireEdition(req) {
  const editionId = objectId(req.params.editionId);
  if (!await Edition.exists({ _id: editionId })) throw failure(404, 'Edition not found');
  return editionId;
}
router.post('/editions', permit('editions:configure'), asyncHandler(async (req, res) => {
  res.status(201).json(await createEdition({ name: req.body.name, editionId: req.body.editionId, actorId: req.staff.id }));
}));
router.get('/editions', permit('editions:read'), asyncHandler(async (req, res) => {
  const { limit, offset } = page(req);
  res.json(await Edition.find().select('_id name state version').sort({ _id: 1 }).skip(offset).limit(limit).lean());
}));
router.get('/editions/:editionId', permit('editions:read'), asyncHandler(async (req, res) => {
  const edition = await Edition.findById(objectId(req.params.editionId)).select('_id name state version rules cardSettingsLockedAt listClosedAt').lean();
  if (!edition) throw failure(404, 'Edition not found');
  res.json(edition);
}));
router.post('/editions/:editionId/configuration', permit('editions:configure'), asyncHandler(async (req, res) => {
  res.json(await configureEdition({ editionId: objectId(req.params.editionId), key: req.get('Idempotency-Key'),
    expectedVersion: req.body.expectedVersion, actorId: req.staff.id, input: { rules: req.body.rules } }));
}));
router.get('/editions/:editionId/configurations', permit('editions:read'), asyncHandler(async (req, res) => {
  const editionId = await requireEdition(req);
  const { limit, offset } = page(req);
  res.json(await ConfigVersion.find({ editionId }).select('_id version rules createdAt').sort({ version: 1 }).skip(offset).limit(limit).lean());
}));
router.get('/editions/:editionId/participants', permit('participants:read'), asyncHandler(async (req, res) => {
  const editionId = await requireEdition(req);
  const { limit, offset } = page(req);
  res.json(await Participant.find({ editionId }).select('_id editionId sourceRowId active').sort({ _id: 1 }).skip(offset).limit(limit).lean());
}));
router.get('/editions/:editionId/participants/:participantId/contact', permit('contacts:read'), asyncHandler(async (req, res) => {
  const editionId = await requireEdition(req);
  const participant = await Participant.findOne({ _id: objectId(req.params.participantId), editionId })
    .select('_id name email phone').lean();
  if (!participant) throw failure(404, 'Participant not found');
  await audit(null, { editionId, actorId: req.staff.id, action: 'participant.contact_viewed', resourceId: participant._id });
  res.json({ id: participant._id, name: participant.name, email: participant.email, phone: participant.phone });
}));
router.get('/editions/:editionId/cards', permit('participants:read'), asyncHandler(async (req, res) => {
  const editionId = await requireEdition(req);
  const { limit, offset } = page(req);
  const cards = await Card.find({ editionId }).select('_id participantId cardCode cells pdf').sort({ _id: 1 }).skip(offset).limit(limit).lean();
  const artifacts = await CardPdf.find({ editionId, cardId: { $in: cards.map(c => c._id) } }).select('cardId sha256').lean();
  const hashes = new Map(artifacts.map(p => [String(p.cardId), p.sha256]));
  res.json(cards.map(card => ({ _id: card._id, participantId: card.participantId, cardCode: card.cardCode, cells: card.cells,
    pdfAvailable: Boolean(card.pdf && hashes.get(String(card._id)) === card.pdf.sha256) })));
}));
router.get('/editions/:editionId/exports/participants', permit('exports:read'), permit('contacts:read'), asyncHandler(async (req, res) => {
  const editionId = await requireEdition(req);
  const { limit, offset } = page(req);
  const rows = await Participant.find({ editionId }).select('_id name email phone').sort({ _id: 1 }).skip(offset).limit(limit).lean();
  await audit(null, { editionId, actorId: req.staff.id, action: 'participants.exported', resourceId: editionId });
  res.json(rows.map(p => ({ id: p._id, name: p.name, email: p.email, phone: p.phone })));
}));
router.get('/audit', permit('audit:read'), asyncHandler(async (req, res) => {
  const { limit, offset } = page(req);
  res.json(await Audit.find().select('eventId editionId actorId actorKind action resourceId commandKey version sequence changedFields occurredAt')
    .sort({ occurredAt: 1, _id: 1 }).skip(offset).limit(limit).lean());
}));
router.get('/editions/:editionId/audit', permit('audit:read'), asyncHandler(async (req, res) => {
  const editionId = await requireEdition(req);
  const { limit, offset } = page(req);
  res.json(await Audit.find({ editionId }).select('eventId editionId actorId actorKind action resourceId commandKey version sequence changedFields occurredAt')
    .sort({ occurredAt: 1, _id: 1 }).skip(offset).limit(limit).lean());
}));
module.exports = router;
