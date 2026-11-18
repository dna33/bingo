const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const M = require('./models');
const { execute, audit, fingerprint } = require('./commands');
const { reconciliation } = require('./imports');
const { sha256 } = require('./cards');
const mockProvider = require('./mock-provider');
const registry = require('./provider-registry');
const failure = require('./errors');
const SPACING_MS = 100,
  LEASE_MS = 60000,
  MAX_ATTEMPTS = 3;
const fail = (code) => Object.assign(failure(409, 'Delivery operation blocked'), { publicCode: code });
const sid = (value) => String(value);
async function transaction(work) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session), { writeConcern: { w: 'majority' } });
  } finally {
    await session.endSession();
  }
}
function scenario(value = 'accepted') {
  if (!mockProvider.scenarios.includes(value)) throw failure(400, 'Invalid simulation scenario');
  return value;
}
function channel(value) {
  if (!['email', 'whatsapp'].includes(value)) throw failure(400, 'Invalid channel');
  return value;
}
function reason(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500)
    throw failure(400, 'A resend/retry reason is required');
  return value.trim();
}
async function createJob(
  { edition, participant, card, queueKey, kind, parentId, sendChannel, simulation, actorId, justification },
  session
) {
  const artifact = await M.CardPdf.findOne({ cardId: card._id, editionId: edition._id })
    .select('sha256')
    .session(session);
  if (!artifact || !card.pdf || artifact.sha256 !== card.pdf.sha256) throw fail('pdf_missing');
  return (
    await M.Delivery.create(
      [
        {
          editionId: edition._id,
          participantId: participant._id,
          cardId: card._id,
          sourceRowId: card.sourceRowId,
          queueKey,
          kind,
          parentId,
          channel: sendChannel,
          recipient: sendChannel === 'email' ? participant.email : participant.phone,
          pdfSha256: artifact.sha256,
          simulation,
          reason: justification,
          createdBy: actorId,
          nextAttemptAt: new Date()
        }
      ],
      { session }
    )
  )[0];
}
async function enqueue(command) {
  const sendChannel = channel(command.input.channel);
  const simulation = scenario(command.input.simulation);
  const limit = command.input.limit === undefined ? 100 : command.input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw failure(400, 'Invalid batch size');
  const selected = command.input.participantIds;
  if (
    selected !== undefined &&
    (!Array.isArray(selected) ||
      !selected.length ||
      selected.length > 100 ||
      new Set(selected).size !== selected.length ||
      selected.some((id) => !mongoose.isValidObjectId(id)))
  )
    throw failure(400, 'Invalid participant selection');
  return execute({ ...command, action: 'deliveries.queued' }, async ({ edition, session }) => {
    if (!edition.listClosedAt || !(await reconciliation(edition, session)).canClose)
      throw fail('delivery_list_not_final');
    const people = await M.Participant.find({
      editionId: edition._id,
      active: true,
      ...(selected ? { _id: { $in: selected } } : {})
    })
      .select('+email +phone')
      .sort({ _id: 1 })
      .session(session);
    if (selected && people.length !== selected.length) throw failure(404, 'Participant not found');
    const jobs = await M.Delivery.find({ editionId: edition._id, kind: 'initial' })
      .select('participantId')
      .session(session);
    const queued = new Set(jobs.map((j) => sid(j.participantId)));
    const pending = people.filter((p) => !queued.has(p.id));
    const cards = await M.Card.find({
      editionId: edition._id,
      participantId: { $in: pending.slice(0, limit).map((p) => p._id) }
    }).session(session);
    const byPerson = new Map(cards.map((c) => [sid(c.participantId), c]));
    for (const person of pending.slice(0, limit)) {
      const card = byPerson.get(person.id);
      if (!card) throw fail('pdf_missing');
      const job = await createJob(
        {
          edition,
          participant: person,
          card,
          queueKey: `initial-${card.id}`,
          kind: 'initial',
          sendChannel,
          simulation,
          actorId: command.actorId
        },
        session
      );
      await audit(session, {
        editionId: edition._id,
        actorId: command.actorId,
        action: 'delivery.queued',
        resourceId: job._id
      });
    }
    await M.DeliveryControl.updateOne(
      { editionId: edition._id },
      { $setOnInsert: { nextDispatchAt: new Date(0) } },
      { upsert: true, session }
    );
    return {
      version: edition.version,
      queued: Math.min(limit, pending.length),
      remaining: Math.max(0, pending.length - limit)
    };
  });
}
async function scopedJob(editionId, jobId, session, privateFields = false) {
  if (!mongoose.isValidObjectId(jobId)) throw failure(400, 'Invalid delivery identifier');
  const job = await M.Delivery.findOne({ _id: jobId, editionId })
    .select(privateFields ? '+recipient +reason +providerReference +retryHistory' : '')
    .session(session);
  if (!job) throw failure(404, 'Delivery not found');
  return job;
}
async function resend(command) {
  const sendChannel = channel(command.input.channel),
    simulation = scenario(command.input.simulation),
    justification = reason(command.input.reason);
  return execute({ ...command, action: 'delivery.resent' }, async ({ edition, session }) => {
    const old = await scopedJob(edition._id, command.input.jobId, session);
    if (
      await M.Delivery.exists({
        editionId: edition._id,
        cardId: old.cardId,
        state: { $in: ['uncertain', 'processing'] }
      }).session(session)
    )
      throw fail('delivery_uncertain');
    if (old.state === 'pending') throw fail('delivery_still_pending');
    const participant = await M.Participant.findOne({
      _id: old.participantId,
      editionId: edition._id,
      active: true
    })
      .select('+email +phone')
      .session(session);
    const card = await M.Card.findOne({
      _id: old.cardId,
      editionId: edition._id,
      participantId: old.participantId
    }).session(session);
    if (!participant || !card) throw fail('delivery_participant_inactive');
    const job = await createJob(
      {
        edition,
        participant,
        card,
        queueKey: `resend-${command.key}`,
        kind: 'resend',
        parentId: old._id,
        sendChannel,
        simulation,
        actorId: command.actorId,
        justification
      },
      session
    );
    return { version: edition.version, jobId: job.id };
  });
}
async function retry(command) {
  const justification = reason(command.input.reason);
  return execute({ ...command, action: 'delivery.retry_requested' }, async ({ edition, session }) => {
    const job = await scopedJob(edition._id, command.input.jobId, session, true);
    if (['processing', 'uncertain'].includes(job.state)) throw fail('delivery_uncertain');
    if (
      await M.Delivery.exists({
        cardId: job.cardId,
        editionId: edition._id,
        state: { $in: ['processing', 'uncertain'] }
      }).session(session)
    )
      throw fail('delivery_uncertain');
    if (!['failed', 'bounced'].includes(job.state)) throw fail('delivery_not_retryable');
    job.retryHistory.push({
      reason: justification,
      requestedBy: command.actorId,
      requestedAt: new Date(),
      previousState: job.state
    });
    job.state = 'pending';
    job.nextAttemptAt = new Date();
    job.retryable = false;
    if (command.input.simulation !== undefined) job.simulation = scenario(command.input.simulation);
    // The original snapshot remains fixed. A new destination/channel requires an explicit resend.
    await job.save({ session });
    return { version: edition.version, jobId: job.id, state: job.state };
  });
}
async function claim(editionId, now) {
  return transaction(async (session) => {
    const job = await M.Delivery.findOne({ editionId, state: 'pending', nextAttemptAt: { $lte: now } })
      .select('+recipient')
      .sort({ nextAttemptAt: 1, _id: 1 })
      .session(session);
    if (!job) return null;
    const gate = await M.DeliveryControl.findOneAndUpdate(
      { editionId, nextDispatchAt: { $lte: now } },
      { $set: { nextDispatchAt: new Date(now.getTime() + SPACING_MS) } },
      { session }
    );
    if (!gate) return null;
    job.state = 'processing';
    job.leaseToken = randomUUID();
    job.leaseUntil = new Date(now.getTime() + LEASE_MS);
    job.attemptCount++;
    job.providerKey = `${job.id}-${job.attemptCount}`;
    job.errorCode = undefined;
    await job.save({ session });
    await M.SendAttempt.create(
      [
        {
          editionId,
          jobId: job._id,
          participantId: job.participantId,
          cardId: job.cardId,
          operationKey: job.id,
          attempt: job.attemptCount,
          providerKey: job.providerKey,
          pdfSha256: job.pdfSha256,
          channel: job.channel,
          recipient: job.recipient,
          state: 'processing',
          attemptedAt: now
        }
      ],
      { session }
    );
    await audit(session, { editionId, actorKind: 'worker', action: 'delivery.claimed', resourceId: job._id });
    return job.toObject();
  });
}
async function finish(job, outcome, now) {
  return transaction(async (session) => {
    const current = await M.Delivery.findOne({
      _id: job._id,
      leaseToken: job.leaseToken,
      state: job.state,
      providerKey: job.providerKey
    }).session(session);
    if (!current) return false;
    let state = outcome.state;
    const retryable = Boolean(outcome.retryable);
    current.state = state;
    current.errorCode = outcome.errorCode;
    current.retryable = retryable;
    if (outcome.reference) current.providerReference = outcome.reference;
    if (['provider_accepted', 'delivered', 'bounced'].includes(state))
      current.acceptedAt = current.acceptedAt || outcome.acceptedAt || now;
    if (state === 'delivered') current.deliveredAt = outcome.statusAt || now;
    if (state === 'bounced') current.bouncedAt = outcome.statusAt || now;
    if (state === 'failed' && retryable && current.attemptCount < MAX_ATTEMPTS) {
      current.state = 'pending';
      current.nextAttemptAt = new Date(now.getTime() + 1000 * 2 ** (current.attemptCount - 1));
    }
    await current.save({ session });
    await M.SendAttempt.updateOne(
      { jobId: current._id, attempt: current.attemptCount },
      {
        $set: {
          state,
          retryable,
          errorCode: outcome.errorCode || null,
          providerReference: outcome.reference || null,
          completedAt: state === 'uncertain' ? null : now
        }
      },
      { session }
    );
    await audit(session, {
      editionId: current.editionId,
      actorKind: 'worker',
      action: `delivery.${state}`,
      resourceId: current._id
    });
    return true;
  });
}
async function reconcile(editionId, jobId, now = new Date()) {
  let job = await scopedJob(editionId, jobId);
  if (job.state === 'processing' && job.leaseUntil <= now) {
    await finish(job.toObject(), { state: 'uncertain', errorCode: 'worker_interrupted' }, now);
    job = await scopedJob(editionId, jobId);
  }
  if (!['uncertain', 'provider_accepted'].includes(job.state)) return { state: job.state };
  const result = await registry.forChannel(job.channel).lookup(job);
  await M.Delivery.updateOne(
    { _id: job._id, providerKey: job.providerKey, state: job.state },
    { $set: { lastCheckedAt: now } }
  );
  if (!result.found && !result.definitive) return { state: 'uncertain', unresolved: true };
  const outcome = result.found
    ? { ...result, state: result.state }
    : { state: 'failed', retryable: true, errorCode: 'provider_not_accepted' };
  if (job.state === outcome.state) return { state: job.state };
  await finish(job, outcome, now);
  return { state: (await scopedJob(editionId, jobId)).state };
}
async function expireLeases(editionId, now) {
  const expired = await M.Delivery.find({ editionId, state: 'processing', leaseUntil: { $lte: now } }).limit(
    100
  );
  for (const job of expired)
    await finish(job.toObject(), { state: 'uncertain', errorCode: 'worker_interrupted' }, now);
}
async function processBatch(editionId, { limit = 25, now = () => new Date(), afterProvider } = {}) {
  if (!mongoose.isValidObjectId(editionId) || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw failure(400, 'Invalid worker batch');
  await expireLeases(editionId, now());
  const uncertain = await M.Delivery.find({ editionId, state: { $in: ['uncertain', 'provider_accepted'] } })
    .sort({ lastCheckedAt: 1, _id: 1 })
    .limit(100);
  for (const job of uncertain) await reconcile(editionId, job.id, now());
  let processed = 0;
  while (processed < limit) {
    const job = await claim(editionId, now());
    if (!job) break;
    try {
      const participant = await M.Participant.findOne({
        _id: job.participantId,
        editionId,
        active: true
      }).select('+email +phone');
      if (!participant) throw Object.assign(new Error(), { providerCode: 'participant_inactive' });
      if ((job.channel === 'email' ? participant.email : participant.phone) !== job.recipient)
        throw Object.assign(new Error(), { providerCode: 'recipient_changed' });
      const card = await M.Card.findOne({ _id: job.cardId, editionId, participantId: job.participantId });
      const pdf = card && (await M.CardPdf.findOne({ cardId: card._id, editionId }).select('+bytes'));
      if (
        !pdf ||
        !card.pdf ||
        pdf.sha256 !== job.pdfSha256 ||
        sha256(pdf.bytes) !== job.pdfSha256 ||
        card.pdf.sha256 !== job.pdfSha256
      )
        throw Object.assign(new Error(), { providerCode: 'pdf_integrity' });
      const result = await registry.forChannel(job.channel).send(
        {
          idempotencyKey: job.providerKey,
          to: job.recipient,
          channel: job.channel,
          attachment: {
            bytes: Buffer.from(pdf.bytes),
            sha256: job.pdfSha256,
            contentType: 'application/pdf',
            filename: `carton-${card.cardCode}.pdf`
          }
        },
        job
      );
      // Test-only crash boundary: a real worker may die here, before recording acceptance.
      if (afterProvider) await afterProvider(job);
      await finish(job, { state: 'provider_accepted', reference: result.reference }, now());
    } catch (error) {
      if (error.simulatedCrash) throw error;
      await finish(
        job,
        {
          state: error.uncertain || !error.providerCode ? 'uncertain' : 'failed',
          errorCode: error.providerCode || 'provider_unavailable',
          retryable: Boolean(error.retryable)
        },
        now()
      );
    }
    processed++;
  }
  return { processed, providers: registry.status(), retryAfterMs: SPACING_MS };
}
async function mockEvent(command) {
  const { jobId, eventKey, status, providerKey } = command.input;
  if (
    typeof eventKey !== 'string' ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(eventKey) ||
    !['provider_accepted', 'delivered', 'bounced', 'not_accepted'].includes(status)
  )
    throw failure(400, 'Invalid simulated event');
  const digest = fingerprint({ jobId, status, providerKey });
  const result = await execute(
    { ...command, action: 'delivery.mock_event' },
    async ({ edition, session }) => {
      const job = await scopedJob(edition._id, jobId, session, true);
      if (!job.providerKey || job.state === 'processing') throw fail('delivery_uncertain');
      const seen = await M.DeliveryEvent.findOne({ editionId: edition._id, eventKey }).session(session);
      if (seen) {
        if (seen.fingerprint !== digest) throw fail('delivery_event_conflict');
        return { version: edition.version, jobId: job.id };
      }
      if (providerKey !== job.providerKey) throw fail('delivery_event_conflict');
      let receipt = await M.MockReceipt.findOne({ providerKey: job.providerKey }).session(session);
      if (receipt && receipt.state === 'not_accepted' && status !== 'not_accepted')
        throw fail('delivery_event_conflict');
      if (
        receipt &&
        ((['delivered', 'bounced'].includes(receipt.state) && receipt.state !== status) ||
          (status === 'not_accepted' && receipt.state !== 'not_accepted'))
      )
        throw fail('delivery_event_conflict');
      if (!receipt && !['uncertain', 'failed'].includes(job.state)) throw fail('delivery_event_conflict');
      if (!receipt) {
        const card = await M.Card.findById(job.cardId).session(session);
        receipt = new M.MockReceipt({
          providerKey: job.providerKey,
          jobId: job._id,
          editionId: edition._id,
          channel: job.channel,
          recipient: job.recipient,
          payloadHash: fingerprint({
            to: job.recipient,
            channel: job.channel,
            sha256: job.pdfSha256,
            filename: `carton-${card.cardCode}.pdf`
          }),
          attachmentSha256: job.pdfSha256,
          attachmentSize: 0,
          filename: `carton-${card.cardCode}.pdf`,
          contentType: 'application/pdf',
          state: status,
          statusAt: new Date()
        });
      }
      receipt.state = status;
      receipt.statusAt = new Date();
      if (status !== 'not_accepted') receipt.acceptedAt = receipt.acceptedAt || new Date();
      await receipt.save({ session });
      await M.DeliveryEvent.create(
        [{ editionId: edition._id, jobId: job._id, eventKey, fingerprint: digest, status }],
        { session }
      );
      return { version: edition.version, jobId: job.id };
    }
  );
  await reconcile(command.editionId, jobId);
  return result;
}
module.exports = {
  enqueue,
  resend,
  retry,
  processBatch,
  reconcile,
  mockEvent,
  SPACING_MS,
  LEASE_MS,
  MAX_ATTEMPTS
};
