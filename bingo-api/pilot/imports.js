const mongoose = require('mongoose');
const { createHash } = require('node:crypto');
const M = require('./models');
const { execute, audit } = require('./commands');
const { decodeFile, parseCsv, normalize } = require('./csv');
const failure = require('./errors');
const sid = (value) => String(value);
const conflict = (code) => Object.assign(failure(409, 'Import cannot proceed'), { publicCode: code });
function editable(edition) {
  if (edition.state !== 'preparation' || edition.listClosedAt) throw conflict('list_frozen');
}
function reference(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000)
    throw failure(400, 'Polla reference required');
  return value.trim();
}
async function importFor(editionId, importId, session) {
  if (!mongoose.isValidObjectId(importId)) throw failure(400, 'Invalid import identifier');
  const doc = await M.ImportVersion.findOne({ _id: importId, editionId }).session(session);
  if (!doc) throw failure(404, 'Import not found');
  return doc;
}
function pair(p) {
  return JSON.stringify([p.email, p.phone]);
}
function same(p, q) {
  return pair(p) === pair(q) && (!q.name || p.name === q.name);
}

// Preview is calculated against the current participant snapshot. Shared contacts never
// identify a person on their own; explicit decisions retain the operator and Polla reference.
function analyze(rows, participants) {
  const entities = new Map(
    participants.map((p) => [sid(p._id), { ...p, id: sid(p._id), existing: true, wasActive: p.active }])
  );
  const plans = [],
    seen = new Map();
  for (const row of rows) {
    const decision = row.decision || {};
    if (decision.kind === 'exclude') {
      plans.push({ row, status: 'resolved', issues: [], outcome: 'excluded' });
      continue;
    }
    const normalized = normalize(decision.corrected || row.raw.values);
    const data = normalized.data;
    const issues = [...(decision.corrected ? [] : row.structureIssues || []), ...normalized.issues];
    const plan = { row, data, status: 'valid', issues, outcome: 'included' };
    if (issues.length) {
      plan.status = 'invalid';
      plans.push(plan);
      continue;
    }
    const signature = JSON.stringify(data);
    const earlier = seen.get(signature);
    let target,
      create = false;
    if (decision.kind === 'link') {
      target = entities.get(sid(decision.participantId));
      if (!target || !target.existing) issues.push('link_target_missing');
      else if (data.externalId && target.externalId && data.externalId !== target.externalId)
        issues.push('external_id_mismatch');
    } else if (decision.kind !== 'separate' && earlier) {
      target = entities.get(earlier.targetId);
      plan.duplicateOfRowId = earlier.row._id;
      if (!same(target, data) && decision.kind !== 'correct') issues.push('identity_contacts_changed');
      if (!data.externalId && [...entities.values()].filter((p) => pair(p) === pair(data)).length > 1) {
        issues.push('shared_contact_requires_resolution');
      }
    } else {
      const external = [...entities.values()].filter(
        (p) => data.externalId && p.externalId === data.externalId
      );
      const exact = [...entities.values()].filter((p) => pair(p) === pair(data));
      if (external.length) {
        target = external[0];
        if (!same(target, data) && decision.kind !== 'correct') issues.push('identity_contacts_changed');
        if (decision.kind === 'separate') issues.push('external_id_already_used');
      } else if (!data.externalId && exact.length === 1 && decision.kind !== 'separate') {
        target = exact[0];
        if (!same(target, data) && decision.kind !== 'correct') issues.push('contact_name_changed');
      } else {
        const shared = [...entities.values()].filter((p) => p.email === data.email || p.phone === data.phone);
        if (shared.length && decision.kind !== 'separate') issues.push('shared_contact_requires_resolution');
        create = true;
      }
    }
    if (target && !target.active && decision.kind !== 'link')
      issues.push('inactive_participant_requires_resolution');
    if (
      target &&
      data.externalId &&
      [...entities.values()].some((p) => p.id !== target.id && p.externalId === data.externalId)
    ) {
      issues.push('external_id_already_used');
    }
    if (issues.length) {
      plan.status = 'conflict';
      plan.suggestedParticipantIds = [...entities.values()]
        .filter(
          (p) =>
            p.existing &&
            ((p.externalId && p.externalId === data.externalId) ||
              p.email === data.email ||
              p.phone === data.phone)
        )
        .map((p) => p.id);
    } else {
      if (create) target = { ...data, id: sid(row._id), active: true, existing: false, sourceRowId: row._id };
      plan.targetId = target.id;
      plan.create = create;
      plan.status = decision.kind ? 'resolved' : target.existing || earlier ? 'duplicate' : 'valid';
      // Do not erase existing names/external IDs when an optional CSV field is absent.
      target = {
        ...target,
        ...data,
        name: data.name || target.name || '',
        externalId: data.externalId || target.externalId || '',
        active: true
      };
      entities.set(target.id, target);
      seen.set(signature, plan);
    }
    plans.push(plan);
  }
  return {
    plans,
    entities,
    unresolved: plans.filter((p) => ['invalid', 'conflict'].includes(p.status)).length
  };
}
async function snapshot(editionId, importId, session) {
  const rows = await M.ImportRow.find({ editionId, importId })
    .select('+raw +decision +decisions')
    .sort({ rowNumber: 1 })
    .session(session)
    .lean();
  const participants = await M.Participant.find({ editionId })
    .select('+name +email +phone')
    .session(session)
    .lean();
  return analyze(rows, participants);
}
function summarize(plans) {
  const count = (status) => plans.filter((p) => p.status === status).length;
  return {
    rows: plans.length,
    valid: count('valid'),
    invalid: count('invalid'),
    duplicates: count('duplicate'),
    conflicts: count('conflict'),
    resolved: count('resolved'),
    excluded: plans.filter((p) => p.outcome === 'excluded').length,
    uniqueParticipants: new Set(plans.filter((p) => p.targetId).map((p) => p.targetId)).size
  };
}
async function stageImport(command) {
  const { contentBase64, filename, sourceReference } = command.input;
  const sourceRef = reference(sourceReference);
  if (
    typeof filename !== 'string' ||
    !filename.trim() ||
    filename.length > 200 ||
    /[\r\n\0/\\]/.test(filename)
  )
    throw failure(400, 'Invalid filename');
  const bytes = decodeFile(contentBase64);
  const parsed = parseCsv(bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  // Only the digest enters the command fingerprint input, not a second copy of the CSV.
  return execute(
    { ...command, action: 'import.received', input: { hash, filename, sourceReference: sourceRef } },
    async ({ edition, session }) => {
      editable(edition);
      const existing = await M.ImportVersion.findOne({ editionId: edition._id, sourceHash: hash }).session(
        session
      );
      if (existing)
        return {
          importId: existing.id,
          importVersion: existing.version,
          reused: true,
          version: edition.version
        };
      const last = await M.ImportVersion.findOne({ editionId: edition._id })
        .sort({ version: -1 })
        .session(session);
      const [file] = await M.ImportVersion.create(
        [
          {
            editionId: edition._id,
            version: last ? last.version + 1 : 1,
            filename,
            sourceReference: sourceRef,
            originalFile: bytes,
            sourceHash: hash,
            receivedAt: new Date()
          }
        ],
        { session }
      );
      const rows = parsed.map((row) => ({ ...row, editionId: edition._id, importId: file._id }));
      await M.ImportRow.insertMany(rows, { session });
      const { plans } = await snapshot(edition._id, file._id, session);
      if (plans.length)
        await M.ImportRow.bulkWrite(
          plans.map((p) => ({
            updateOne: {
              filter: { _id: p.row._id },
              update: { $set: { status: p.status, issues: p.issues } }
            }
          })),
          { session }
        );
      return {
        importId: file.id,
        importVersion: file.version,
        reused: false,
        version: edition.version,
        summary: summarize(plans)
      };
    }
  );
}
async function resolveRow(command) {
  const { importId, rowId, decision } = command.input;
  if (!decision || !['correct', 'separate', 'link', 'exclude'].includes(decision.kind))
    throw failure(400, 'Invalid resolution');
  const normalizedDecision = { kind: decision.kind, pollaReference: reference(decision.pollaReference) };
  if (decision.corrected !== undefined) {
    if (
      !decision.corrected ||
      typeof decision.corrected !== 'object' ||
      Array.isArray(decision.corrected) ||
      Object.keys(decision.corrected).some(
        (k) => !['email', 'telefono', 'jugador_id', 'nombre'].includes(k)
      ) ||
      Object.values(decision.corrected).some((v) => typeof v !== 'string') ||
      normalize(decision.corrected).issues.length
    )
      throw failure(400, 'Invalid correction');
    normalizedDecision.corrected = decision.corrected;
  }
  if (decision.kind === 'correct' && !normalizedDecision.corrected)
    throw failure(400, 'A correction is required');
  if (decision.kind === 'link') {
    if (!mongoose.isValidObjectId(decision.participantId)) throw failure(400, 'Invalid link target');
    normalizedDecision.participantId = sid(decision.participantId);
  }
  return execute(
    { ...command, action: 'import.row_resolved', input: { importId, rowId, decision: normalizedDecision } },
    async ({ edition, session }) => {
      editable(edition);
      const file = await importFor(edition._id, importId, session);
      if (file.status === 'applied') throw conflict('import_already_applied');
      if (!mongoose.isValidObjectId(rowId)) throw failure(400, 'Invalid row');
      if (
        decision.kind === 'link' &&
        !(await M.Participant.exists({
          _id: normalizedDecision.participantId,
          editionId: edition._id
        }).session(session))
      )
        throw failure(404, 'Participant not found');
      const resolved = { ...normalizedDecision, operatorId: command.actorId, resolvedAt: new Date() };
      const row = await M.ImportRow.findOneAndUpdate(
        { _id: rowId, editionId: edition._id, importId },
        { $set: { decision: resolved }, $push: { decisions: resolved } },
        { session, new: true }
      );
      if (!row) throw failure(404, 'Row not found');
      const { plans } = await snapshot(edition._id, importId, session);
      await M.ImportRow.bulkWrite(
        plans.map((p) => ({
          updateOne: { filter: { _id: p.row._id }, update: { $set: { status: p.status, issues: p.issues } } }
        })),
        { session }
      );
      return { importId: file.id, rowId: row.id, version: edition.version, summary: summarize(plans) };
    }
  );
}
async function applyImport(command) {
  return execute({ ...command, action: 'import.applied' }, async ({ edition, session }) => {
    editable(edition);
    const file = await importFor(edition._id, command.input.importId, session);
    if (file.status === 'applied') return { importId: file.id, reused: true, version: edition.version };
    if (
      await M.ImportVersion.exists({ editionId: edition._id, version: { $gt: file.version } }).session(
        session
      )
    )
      throw conflict('import_superseded');
    const { plans, entities, unresolved } = await snapshot(edition._id, file._id, session);
    if (unresolved) throw conflict('import_unresolved');
    const targetIds = [...new Set(plans.filter((p) => p.targetId).map((p) => p.targetId))];
    const participantWrites = [];
    for (const targetId of targetIds) {
      const entity = entities.get(targetId);
      const sourcePlan = plans.find((p) => p.targetId === targetId);
      const latest = [...plans].reverse().find((p) => p.targetId === targetId && p.row.decision);
      const history = {
        importId: file._id,
        rowId: (latest || sourcePlan).row._id,
        operatorId: command.actorId,
        occurredAt: new Date(),
        pollaReference: latest ? latest.row.decision.pollaReference : file.sourceReference,
        email: entity.email,
        phone: entity.phone,
        name: entity.name
      };
      if (entity.existing) {
        const update = { email: entity.email, phone: entity.phone, name: entity.name, active: true };
        if (entity.externalId) update.externalId = entity.externalId;
        participantWrites.push({
          updateOne: {
            filter: { _id: targetId, editionId: edition._id },
            update: {
              $set: update,
              $push: {
                contactHistory: history,
                ...(entity.wasActive === false
                  ? {
                      activityHistory: {
                        active: true,
                        importId: file._id,
                        pollaReference: history.pollaReference,
                        operatorId: command.actorId,
                        occurredAt: new Date()
                      }
                    }
                  : {})
              }
            }
          }
        });
      } else {
        participantWrites.push({
          insertOne: {
            document: {
              _id: targetId,
              editionId: edition._id,
              sourceRowId: sourcePlan.row._id,
              participantKey: `internal-${targetId}`,
              ...(entity.externalId ? { externalId: entity.externalId } : {}),
              name: entity.name,
              email: entity.email,
              phone: entity.phone,
              active: true,
              contactHistory: [history]
            }
          }
        });
      }
    }
    if (participantWrites.length) await M.Participant.bulkWrite(participantWrites, { session });
    await M.ImportRow.bulkWrite(
      plans.map((p) => ({
        updateOne: {
          filter: { _id: p.row._id },
          update: {
            $set: {
              status: p.status,
              issues: p.issues,
              outcome: p.outcome,
              ...(p.targetId ? { participantId: p.targetId } : {}),
              ...(p.duplicateOfRowId ? { duplicateOfRowId: p.duplicateOfRowId } : {})
            }
          }
        }
      })),
      { session }
    );
    file.status = 'applied';
    file.approvedAt = new Date();
    file.approvedBy = command.actorId;
    await file.save({ session });
    edition.approvedImportId = file._id;
    await edition.save({ session });
    return { importId: file.id, version: edition.version, summary: summarize(plans) };
  });
}
async function setActivity(command) {
  const { participantId, active, pollaReference } = command.input;
  const ref = reference(pollaReference);
  if (typeof active !== 'boolean' || !mongoose.isValidObjectId(participantId))
    throw failure(400, 'Invalid activity change');
  return execute({ ...command, action: 'participant.activity_changed' }, async ({ edition, session }) => {
    editable(edition);
    const participant = await M.Participant.findOneAndUpdate(
      { _id: participantId, editionId: edition._id },
      {
        $set: { active },
        $push: {
          activityHistory: {
            active,
            pollaReference: ref,
            operatorId: command.actorId,
            occurredAt: new Date()
          }
        }
      },
      { session, new: true }
    );
    if (!participant) throw failure(404, 'Participant not found');
    return { participantId: participant.id, active, version: edition.version };
  });
}
async function reconciliation(edition, session) {
  const editionId = edition._id;
  const file = edition.approvedImportId
    ? await M.ImportVersion.findOne({ _id: edition.approvedImportId, editionId }).session(session).lean()
    : null;
  const rows = file ? await M.ImportRow.find({ editionId, importId: file._id }).session(session).lean() : [];
  const participants = await M.Participant.find({ editionId })
    .select('_id active sourceRowId')
    .session(session)
    .lean();
  const cards = await M.Card.find({ editionId })
    .select('_id participantId sourceRowId pdf')
    .session(session)
    .lean();
  const pdfs = await M.CardPdf.find({ editionId }).select('cardId sha256').session(session).lean();
  const pdfByCard = new Map(pdfs.map(pdf => [sid(pdf.cardId), pdf.sha256]));
  const expected = new Set(
    rows.filter((r) => r.outcome === 'included' && r.participantId).map((r) => sid(r.participantId))
  );
  const active = new Set(participants.filter((p) => p.active).map((p) => sid(p._id)));
  const all = new Map(participants.map((p) => [sid(p._id), p]));
  const origins = await M.ImportRow.find({ editionId, _id: { $in: participants.map((p) => p.sourceRowId) } })
    .select('_id participantId')
    .session(session)
    .lean();
  const originMap = new Map(origins.map((r) => [sid(r._id), sid(r.participantId)]));
  const hasCard = new Set(cards.map((c) => sid(c.participantId)));
  const pendingFiles = await M.ImportVersion.countDocuments({
    editionId,
    version: { $gt: file ? file.version : 0 },
    status: 'staged'
  }).session(session);
  const report = {
    editionId: sid(editionId),
    version: edition.version,
    listClosed: Boolean(edition.listClosedAt),
    approvedImportId: file ? sid(file._id) : null,
    importVersion: file ? file.version : null,
    sourceReference: file ? file.sourceReference : null,
    receivedAt: file ? file.receivedAt : null,
    rows: rows.length,
    excludedRows: rows.filter((r) => r.outcome === 'excluded').length,
    duplicatesResolved: rows.filter((r) => r.status === 'duplicate' || r.duplicateOfRowId).length,
    uniqueParticipants: expected.size,
    activeParticipants: active.size,
    issuedCards: cards.filter((c) => active.has(sid(c.participantId))).length,
    unresolvedRows: rows
      .filter((r) => !r.outcome || (r.outcome === 'included' && !r.participantId))
      .map((r) => r.rowNumber),
    missingParticipantIds: [...expected].filter((id) => !active.has(id)),
    extraParticipantIds: [...active].filter((id) => !expected.has(id)),
    untraceableParticipantIds: participants
      .filter((p) => p.active && originMap.get(sid(p.sourceRowId)) !== sid(p._id))
      .map((p) => sid(p._id)),
    withoutCardIds: [...expected].filter((id) => !hasCard.has(id)),
    withoutPdfIds: cards.filter(card => active.has(sid(card.participantId)) &&
      (!card.pdf || pdfByCard.get(sid(card._id)) !== card.pdf.sha256)).map(card => sid(card._id)),
    inconsistentCardIds: cards
      .filter(
        (c) =>
          !all.has(sid(c.participantId)) ||
          sid(all.get(sid(c.participantId)).sourceRowId) !== sid(c.sourceRowId)
      )
      .map((c) => sid(c._id)),
    pendingFiles
  };
  report.canClose = Boolean(
    file &&
      expected.size &&
      !pendingFiles &&
      !report.unresolvedRows.length &&
      !report.missingParticipantIds.length &&
      !report.extraParticipantIds.length &&
      !report.untraceableParticipantIds.length &&
      !report.withoutCardIds.length &&
      !report.withoutPdfIds.length &&
      !report.inconsistentCardIds.length
  );
  return report;
}
async function closeList(command) {
  return execute({ ...command, action: 'participants.closed' }, async ({ edition, session }) => {
    editable(edition);
    const report = await reconciliation(edition, session);
    if (!report.canClose) throw conflict('reconciliation_incomplete');
    edition.listClosedAt = new Date();
    edition.listClosedBy = command.actorId;
    await edition.save({ session });
    return { version: edition.version, listClosed: true };
  });
}
async function readPreview(editionId, importId, actorId, limit, offset) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const file = await importFor(editionId, importId, session);
      let plans;
      if (file.status === 'applied') {
        const rows = await M.ImportRow.find({ editionId, importId })
          .select('+raw +decision +decisions')
          .sort({ rowNumber: 1 })
          .session(session)
          .lean();
        plans = rows.map((row) => ({
          row,
          data: normalize((row.decision && row.decision.corrected) || row.raw.values).data,
          status: row.status,
          issues: row.issues,
          outcome: row.outcome,
          targetId: row.participantId && sid(row.participantId)
        }));
      } else {
        ({ plans } = await snapshot(editionId, importId, session));
      }
      const edition = await M.Edition.findById(editionId).session(session);
      result = {
        importId: file.id,
        importVersion: file.version,
        filename: file.filename,
        sourceReference: file.sourceReference,
        state: file.status,
        editionVersion: edition.version,
        listClosed: Boolean(edition.listClosedAt),
        summary: summarize(plans),
        rows: plans.slice(offset, offset + limit).map((p) => ({
          id: sid(p.row._id),
          rowNumber: p.row.rowNumber,
          values: p.row.raw.values,
          effective: p.data,
          status: p.status,
          issues: p.issues,
          outcome: p.outcome,
          targetId: p.targetId,
          suggestedParticipantIds: p.suggestedParticipantIds || [],
          decision: p.row.decision || null,
          decisions: p.row.decisions || []
        }))
      };
      await audit(session, { editionId, actorId, action: 'import.preview_viewed', resourceId: file._id });
    });
    return result;
  } finally {
    await session.endSession();
  }
}
module.exports = {
  stageImport,
  resolveRow,
  applyImport,
  setActivity,
  reconciliation,
  closeList,
  readPreview
};
