const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/async-handler');
const { permit } = require('./auth');
const { Edition, ImportVersion } = require('./models');
const { audit } = require('./commands');
const failure = require('./errors');
const imports = require('./imports');
const router = express.Router({ mergeParams: true });
router.use((req, res, next) => {
  if (!/^\/(imports(?:\/|$)|reconciliation$|participants\/(?:close$|[^/]+\/activity$))/.test(req.path))
    return next('router');
  next();
});
router.use(permit('imports:read'), permit('contacts:read'));
router.use(
  asyncHandler(async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.editionId)) throw failure(400, 'Invalid edition');
    if (!(await Edition.exists({ _id: req.params.editionId }))) throw failure(404, 'Edition not found');
    next();
  })
);
function command(req, extra = {}) {
  return {
    editionId: req.params.editionId,
    actorId: req.staff.id,
    key: req.get('Idempotency-Key'),
    expectedVersion: req.body.expectedVersion,
    input: { ...req.body, ...extra }
  };
}
router.get(
  '/imports',
  asyncHandler(async (req, res) => {
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw failure(400, 'Invalid pagination');
    const rows = await ImportVersion.find({ editionId: req.params.editionId })
      .select('_id version filename sourceReference status receivedAt approvedAt')
      .sort({ version: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'imports.list_viewed',
      resourceId: req.params.editionId
    });
    res.json(rows);
  })
);
router.post(
  '/imports',
  permit('imports:write'),
  asyncHandler(async (req, res) => res.status(201).json(await imports.stageImport(command(req))))
);
router.get(
  '/imports/:importId/preview',
  asyncHandler(async (req, res) => {
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw failure(400, 'Invalid pagination');
    res.json(
      await imports.readPreview(req.params.editionId, req.params.importId, req.staff.id, limit, offset)
    );
  })
);
router.get(
  '/imports/:importId/original',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.importId)) throw failure(400, 'Invalid import');
    const file = await ImportVersion.findOne({
      _id: req.params.importId,
      editionId: req.params.editionId
    }).select('+originalFile');
    if (!file) throw failure(404, 'Import not found');
    await audit(null, {
      editionId: req.params.editionId,
      actorId: req.staff.id,
      action: 'import.original_downloaded',
      resourceId: file._id
    });
    res
      .set('Content-Disposition', `attachment; filename="import-${file.id}.csv"`)
      .type('text/csv')
      .send(file.originalFile);
  })
);
router.post(
  '/imports/:importId/rows/:rowId/resolve',
  permit('imports:write'),
  asyncHandler(async (req, res) => {
    res.json(
      await imports.resolveRow(command(req, { importId: req.params.importId, rowId: req.params.rowId }))
    );
  })
);
router.post(
  '/imports/:importId/apply',
  permit('imports:write'),
  asyncHandler(async (req, res) => {
    res.json(await imports.applyImport(command(req, { importId: req.params.importId })));
  })
);
router.post(
  '/participants/:participantId/activity',
  permit('imports:write'),
  asyncHandler(async (req, res) => {
    res.json(await imports.setActivity(command(req, { participantId: req.params.participantId })));
  })
);
router.get(
  '/reconciliation',
  asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    let report;
    try {
      await session.withTransaction(async () => {
        const edition = await Edition.findById(req.params.editionId).session(session);
        report = await imports.reconciliation(edition, session);
        await audit(session, {
          editionId: edition._id,
          actorId: req.staff.id,
          action: 'participants.reconciled',
          resourceId: edition._id
        });
      });
      res.json(report);
    } finally {
      await session.endSession();
    }
  })
);
router.post(
  '/participants/close',
  permit('imports:write'),
  asyncHandler(async (req, res) => res.json(await imports.closeList(command(req))))
);
module.exports = router;
