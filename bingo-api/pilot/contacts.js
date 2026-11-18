const mongoose = require('mongoose');
const M = require('./models');
const { execute, audit } = require('./commands');
const failure = require('./errors');
const blocked = (code) => Object.assign(failure(409, 'Contact operation blocked'), { publicCode: code });
function evidence(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    throw Object.assign(failure(400, 'Contact evidence required'), { publicCode: 'contact_evidence' });
  return value.trim();
}
// The clock is injectable only at this internal service boundary, never from an HTTP request.
function createService(clock = () => new Date()) {
  async function act(command, action, work) {
    if (!mongoose.isValidObjectId(command.input.candidateId)) throw failure(400, 'Invalid candidate');
    return execute({ ...command, action: `candidate.${action}` }, async ({ edition, session }) => {
      const candidate = await M.Candidate.findOne({
        _id: command.input.candidateId,
        editionId: edition._id
      })
        .select('+recipient +responseEvidence')
        .session(session);
      if (!candidate) throw failure(404, 'Candidate not found');
      if (candidate.cohort !== 'primary') throw blocked('contact_reserve');
      if (['confirmed', 'discarded', 'delivered'].includes(candidate.state))
        throw blocked('contact_resolved');
      const result = await M.FigureResult.findOne({
        roundId: candidate.roundId,
        figure: candidate.figure,
        editionId: edition._id
      }).session(session);
      if (!result || ['adjudicated', 'unassigned'].includes(result.state))
        throw blocked('contact_result_closed');
      const now = new Date(clock());
      const before = candidate.state;
      const details = await work(candidate, command.input, now, session);
      await candidate.save({ session });
      await M.ContactEvent.create(
        [
          {
            editionId: edition._id,
            candidateId: candidate._id,
            actorId: command.actorId,
            action,
            occurredAt: now,
            previousState: before,
            nextState: candidate.state,
            ...details
          }
        ],
        { session }
      );
      await audit(session, {
        editionId: edition._id,
        actorId: command.actorId,
        action: `candidate.${action}`,
        resourceId: candidate._id,
        version: edition.version
      });
      return {
        candidateId: candidate.id,
        state: candidate.state,
        version: edition.version,
        contactStartedAt: candidate.contactStartedAt || null,
        expiresAt: candidate.expiresAt || null,
        responseReceivedAt: candidate.responseReceivedAt || null,
        resolution: candidate.resolution || null
      };
    });
  }
  const begin = (command) =>
    act(command, 'contact_started', async (candidate, input, now, session) => {
      if (!['detected', 'contacting'].includes(candidate.state) || candidate.contactStartedAt)
        throw blocked('contact_state');
      if (!['email', 'whatsapp'].includes(input.channel)) throw failure(400, 'Invalid channel');
      const person = await M.Participant.findOne({
        _id: candidate.participantId,
        editionId: candidate.editionId
      })
        .select('email phone')
        .session(session);
      const recipient = person && (input.channel === 'email' ? person.email : person.phone);
      if (!recipient) throw blocked('contact_recipient');
      candidate.state = 'contacting';
      candidate.channel = input.channel;
      candidate.recipient = recipient;
      candidate.contactedBy = command.actorId;
      return { channel: input.channel, recipient, evidence: evidence(input.evidence) };
    });
  const notice = (command) =>
    act(command, 'notice_recorded', async (candidate, input, now) => {
      if (candidate.state !== 'contacting' || candidate.contactStartedAt) throw blocked('contact_state');
      if (typeof input.success !== 'boolean') throw failure(400, 'Notice outcome required');
      if (input.success) {
        candidate.contactedBy = command.actorId;
        candidate.contactStartedAt = now;
        candidate.expiresAt = new Date(now.getTime() + 60000);
        candidate.state = 'awaiting_response';
      }
      return {
        channel: candidate.channel,
        recipient: candidate.recipient,
        evidence: evidence(input.evidence),
        action: input.success ? 'notice_succeeded' : 'notice_failed'
      };
    });
  const respond = (command) =>
    act(command, 'response_recorded', async (candidate, input, now) => {
      if (candidate.state !== 'awaiting_response' || !candidate.expiresAt) throw blocked('contact_state');
      if (
        typeof input.receivedAt !== 'string' ||
        !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(input.receivedAt)
      )
        throw failure(400, 'Response time must include timezone');
      const receivedAt = new Date(input.receivedAt);
      if (
        !Number.isFinite(receivedAt.getTime()) ||
        receivedAt < candidate.contactStartedAt ||
        receivedAt > now
      )
        throw blocked('contact_response_time');
      candidate.responseReceivedAt = receivedAt;
      candidate.responseEvidence = evidence(input.evidence);
      candidate.state = receivedAt <= candidate.expiresAt ? 'confirmed' : 'discarded';
      candidate.resolution = candidate.state === 'confirmed' ? 'timely_response' : 'late_response';
      candidate.resolvedAt = now;
      candidate.resolvedBy = command.actorId;
      return {
        receivedAt,
        channel: candidate.channel,
        recipient: candidate.recipient,
        evidence: candidate.responseEvidence
      };
    });
  const discard = (command) =>
    act(command, 'no_response_resolved', async (candidate, input, now) => {
      if (candidate.state !== 'awaiting_response' || !candidate.expiresAt || now <= candidate.expiresAt)
        throw blocked('contact_not_expired');
      if (input.reviewedNoTimelyResponse !== true) throw blocked('contact_review_required');
      candidate.state = 'discarded';
      candidate.resolution = 'no_timely_response';
      candidate.resolvedAt = now;
      candidate.resolvedBy = command.actorId;
      return {
        evidence: evidence(input.evidence),
        channel: candidate.channel,
        recipient: candidate.recipient
      };
    });
  return { begin, notice, respond, discard };
}
async function acknowledge(command) {
  if (!mongoose.isValidObjectId(command.input.alertId)) throw failure(400, 'Invalid alert');
  return execute({ ...command, action: 'alert.acknowledged' }, async ({ edition, session }) => {
    const alert = await M.CandidateAlert.findOne({
      _id: command.input.alertId,
      editionId: edition._id
    }).session(session);
    if (!alert) throw failure(404, 'Alert not found');
    if (!alert.acknowledgedAt) {
      alert.acknowledgedAt = new Date();
      alert.acknowledgedBy = command.actorId;
      await alert.save({ session });
      await audit(session, {
        editionId: edition._id,
        actorId: command.actorId,
        action: 'alert.acknowledged',
        resourceId: alert._id,
        version: edition.version
      });
    }
    return { alertId: alert.id, acknowledgedAt: alert.acknowledgedAt, version: edition.version };
  });
}
async function reconcileAlerts(command) {
  return execute({ ...command, action: 'alerts.reconciled' }, async ({ edition, session }) => {
    const groups = await M.Candidate.aggregate([
      { $match: { editionId: edition._id } },
      {
        $group: {
          _id: { drawId: '$drawId', figure: '$figure', cohort: '$cohort' },
          roundId: { $first: '$roundId' },
          candidateCount: { $sum: 1 }
        }
      }
    ]).session(session);
    for (const group of groups) {
      const draw = await M.Draw.findById(group._id.drawId).session(session);
      if (!draw || !draw.evaluationComplete) throw failure(409, 'Incomplete official draw');
      await M.CandidateAlert.updateOne(
        group._id,
        {
          $setOnInsert: {
            ...group._id,
            editionId: edition._id,
            roundId: group.roundId,
            candidateCount: group.candidateCount,
            sequence: draw.sequence
          }
        },
        { upsert: true, session }
      );
    }
    return { version: edition.version, groups: groups.length };
  });
}
function publicStatus(candidate, now = new Date()) {
  return {
    ...candidate,
    deadlineStatus:
      candidate.state === 'awaiting_response'
        ? now > candidate.expiresAt
          ? 'expired_pending_review'
          : 'running'
        : null
  };
}
module.exports = { ...createService(), createService, acknowledge, reconcileAlerts, publicStatus };
