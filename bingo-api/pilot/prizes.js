const mongoose = require('mongoose');
const { randomBytes } = require('node:crypto');
const M = require('./models');
const { execute, audit, fingerprint } = require('./commands');
const { names, TOTAL_POOL_CLP } = require('./game-engine');
const { split } = require('./prize-split');
const failure = require('./errors');
const fail = (code) => Object.assign(failure(409, 'Prize operation blocked'), { publicCode: code });
const sid = (value) => String(value);
const available = (pool) => pool.totalClp - pool.allocatedClp - pool.unassignedClp;
function reason(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw fail('prize_evidence');
  return value.trim();
}
function identifier(value) {
  if (!mongoose.isValidObjectId(value)) throw failure(400, 'Invalid prize identifier');
  return value;
}
async function configuration(editionId, session) {
  const edition = await M.Edition.findById(editionId).session(session);
  return edition && edition.gameConfigurationId
    ? M.GameConfiguration.findById(edition.gameConfigurationId).session(session)
    : null;
}
async function ensurePools(editionId, session) {
  const existing = await M.PrizePool.find({ editionId }).session(session);
  if (!existing.length && (await M.Award.exists({ editionId }).session(session))) throw fail('prize_legacy');
  const config = await configuration(editionId, session);
  if (!config) throw fail('prize_legacy');
  for (const figure of config.rules.figures)
    await M.PrizePool.updateOne(
      { editionId, figure: figure.name },
      {
        $setOnInsert: {
          editionId,
          figure: figure.name,
          totalClp: figure.poolClp,
          allocatedClp: 0,
          deliveredClp: 0,
          unassignedClp: 0
        }
      },
      { upsert: true, session }
    );
}
async function checkBudget(editionId, session) {
  const config = await configuration(editionId, session);
  const ledger = await M.PrizePool.find({ editionId }).session(session).lean();
  const awards = await M.Award.find({ editionId }).session(session).lean();
  const credits = await M.PrizeCredit.find({ editionId }).session(session).lean();
  const settlements = await M.PrizeSettlement.find({ editionId }).session(session).lean();
  if (
    !config ||
    ledger.length !== config.rules.figures.length ||
    ledger.reduce((sum, p) => sum + p.totalClp, 0) !== TOTAL_POOL_CLP
  )
    throw fail('prize_budget');
  for (const pool of ledger) {
    const allocated = awards.filter((a) => sid(a.poolId) === sid(pool._id));
    const delivered = credits.filter((c) => sid(c.poolId) === sid(pool._id));
    const configured = config.rules.figures.find((f) => f.name === pool.figure);
    if (
      !configured ||
      pool.totalClp !== configured.poolClp ||
      settlements
        .filter((s) => sid(s.poolId) === sid(pool._id))
        .reduce((sum, s) => sum + s.allocatedClp, 0) !== pool.allocatedClp ||
      settlements
        .filter((s) => sid(s.poolId) === sid(pool._id))
        .reduce((sum, s) => sum + s.unassignedClp, 0) !== pool.unassignedClp ||
      available(pool) < 0 ||
      pool.deliveredClp > pool.allocatedClp ||
      allocated.reduce((sum, a) => sum + a.amountClp, 0) !== pool.allocatedClp ||
      delivered.reduce((sum, c) => sum + c.amountClp, 0) !== pool.deliveredClp ||
      allocated.filter((a) => a.state === 'delivered').reduce((sum, a) => sum + a.amountClp, 0) !==
        pool.deliveredClp
    )
      throw fail('prize_budget');
  }
  const awardById = new Map(awards.map((a) => [sid(a._id), a]));
  if (
    awards.some((a) => !ledger.some((p) => sid(p._id) === sid(a.poolId))) ||
    credits.some((c) => {
      const award = awardById.get(sid(c.awardId));
      return (
        !award ||
        award.state !== 'delivered' ||
        award.amountClp !== c.amountClp ||
        sid(award.participantId) !== sid(c.participantId)
      );
    })
  )
    throw fail('prize_budget');
  return ledger.map((pool) => ({
    ...pool,
    availableClp: available(pool),
    pendingCreditClp: pool.allocatedClp - pool.deliveredClp
  }));
}
async function verifyAccount(command) {
  const { participantId, accountReference, evidence, verifiedWithPolla } = command.input;
  identifier(participantId);
  if (
    typeof accountReference !== 'string' ||
    !/^[A-Za-z0-9._@-]{1,100}$/.test(accountReference) ||
    verifiedWithPolla !== true
  )
    throw fail('prize_account');
  reason(evidence);
  return execute({ ...command, action: 'prize.account_verified' }, async ({ edition, session }) => {
    const participant = await M.Participant.findOne({ _id: participantId, editionId: edition._id }).session(
      session
    );
    if (!participant) throw failure(404, 'Participant not found');
    // Once approved, account destinations cannot be changed by later prize operations.
    if (
      await M.PrizeProposal.exists({
        editionId: edition._id,
        [`accounts.${participantId}`]: { $exists: true },
        confirmedAt: { $exists: true }
      }).session(session)
    )
      throw fail('prize_account_locked');
    const hash = fingerprint(accountReference.toLowerCase());
    if (
      await M.PollaAccount.exists({
        editionId: edition._id,
        accountHash: hash,
        participantId: { $ne: participantId }
      }).session(session)
    )
      throw fail('prize_account_duplicate');
    await M.PollaAccount.updateOne(
      { editionId: edition._id, participantId },
      {
        $set: {
          accountReference,
          accountHash: hash,
          verificationEvidence: evidence.trim(),
          verifiedAt: new Date(),
          verifiedBy: command.actorId
        }
      },
      { upsert: true, session }
    );
    await audit(session, {
      editionId: edition._id,
      actorId: command.actorId,
      action: 'prize.account_verified',
      resourceId: participantId,
      version: edition.version
    });
    return { version: edition.version, participantId };
  });
}
async function context(edition, resultId, session) {
  const result = await M.FigureResult.findOne({ _id: identifier(resultId), editionId: edition._id }).session(
    session
  );
  if (!result) throw failure(404, 'Figure result not found');
  if (!['detected', 'open'].includes(result.state)) throw fail('prize_result_state');
  const config = await M.GameConfiguration.findOne({
    _id: result.gameConfigurationId,
    editionId: edition._id
  }).session(session);
  const configured = config && config.rules.figures.find((f) => f.name === result.figure);
  if (!config || !names.includes(result.figure) || !configured || result.poolClp !== configured.poolClp)
    throw fail('prize_budget');
  const pool = await M.PrizePool.findOne({ editionId: edition._id, figure: result.figure }).session(session);
  if (!pool || available(pool) <= 0) throw fail('prize_budget');
  let exhausted = false;
  if (result.state === 'open') {
    const roster = await M.GameRoster.find({ editionId: edition._id }).session(session);
    if (!roster.length) throw fail('prize_group');
    const seen = await M.Candidate.find({
      editionId: edition._id,
      roundId: result.roundId,
      figure: result.figure
    }).session(session);
    const winners = config.rules.repeatWinners
      ? []
      : await M.Award.find({
          editionId: edition._id,
          amountClp: { $gt: 0 },
          state: { $in: ['confirmed', 'delivered'] }
        }).session(session);
    const remaining = roster.filter(
      (c) =>
        !seen.some((s) => sid(s.cardId) === sid(c.cardId)) &&
        !winners.some((w) => sid(w.participantId) === sid(c.participantId))
    );
    if (remaining.length) throw fail('prize_waiting_candidates');
    exhausted = true;
  }
  const cycle = result.allocationCycle || 0;
  const all = (
    await M.Candidate.find({
      editionId: edition._id,
      roundId: result.roundId,
      figure: result.figure,
      cohort: 'primary'
    })
      .select('+responseEvidence')
      .session(session)
  ).filter((c) => (c.allocationCycle || 0) === cycle);
  if ((!all.length && !exhausted) || all.some((c) => !['confirmed', 'discarded'].includes(c.state)))
    throw fail('prize_pending_responses');
  if (all.length !== result.primaryCandidateCount) throw fail('prize_group');
  const confirmed = all.filter((c) => c.state === 'confirmed');
  for (const c of confirmed) {
    if (
      !c.contactStartedAt ||
      !c.expiresAt ||
      !c.responseReceivedAt ||
      !c.resolvedAt ||
      !c.resolvedBy ||
      !c.contactedBy ||
      typeof c.responseEvidence !== 'string' ||
      !c.responseEvidence.trim() ||
      c.resolvedAt < c.responseReceivedAt ||
      c.responseReceivedAt < c.contactStartedAt ||
      c.responseReceivedAt > c.expiresAt ||
      c.expiresAt - c.contactStartedAt !== 60000 ||
      c.resolution !== 'timely_response'
    )
      throw fail('prize_response_evidence');
  }
  if (await M.Award.exists({ candidateId: { $in: all.map((c) => c._id) } }).session(session))
    throw fail('prize_already_allocated');
  const people = await M.Participant.find({
    editionId: edition._id,
    _id: { $in: confirmed.map((c) => c.participantId) }
  }).session(session);
  const mappings = await M.PollaAccount.find({
    editionId: edition._id,
    participantId: { $in: confirmed.map((c) => c.participantId) }
  })
    .select('+accountReference')
    .session(session);
  const peopleById = new Map(people.map((p) => [sid(p._id), p]));
  const accountsByPerson = new Map(mappings.map((m) => [sid(m.participantId), m]));
  const accounts = {};
  for (const c of confirmed) {
    const person = peopleById.get(sid(c.participantId));
    const mapping = accountsByPerson.get(sid(c.participantId));
    if (!person || !mapping) throw fail('prize_account_missing');
    accounts[sid(c.participantId)] = mapping.accountReference;
  }
  if (new Set(confirmed.map((c) => sid(c.participantId))).size !== confirmed.length)
    throw fail('prize_group');
  const basis = {
    exhausted,
    poolId: pool.id,
    resultId: result.id,
    cycle,
    availableClp: available(pool),
    rules: config.rules,
    candidates: all
      .map((c) => ({
        id: c.id,
        participantId: sid(c.participantId),
        state: c.state,
        receivedAt: c.responseReceivedAt ? c.responseReceivedAt.toISOString() : null,
        resolution: c.resolution || null
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    accounts
  };
  return { result, pool, config, all, confirmed, accounts, basis, exhausted };
}
async function prepare(command) {
  const seed = randomBytes(32).toString('hex');
  reason(command.input.reason);
  return execute({ ...command, action: 'prize.proposal_prepared' }, async ({ edition, session }) => {
    await ensurePools(edition._id, session);
    await checkBudget(edition._id, session);
    const ctx = await context(edition, command.input.resultId, session);
    const existing = await M.PrizeProposal.findOne({
      resultId: ctx.result._id,
      cycle: ctx.result.allocationCycle || 0
    })
      .select('+basis +accounts +reason')
      .session(session);
    if (existing) {
      if (existing.confirmedAt) throw fail('prize_already_allocated');
      // Correcting a destination before approval never gives another residual draw.
      existing.basis = ctx.basis;
      existing.accounts = ctx.accounts;
      existing.snapshotHash = fingerprint(ctx.basis);
      existing.reason = command.input.reason.trim();
      await existing.save({ session });
      return { proposalId: existing.id, version: edition.version };
    }
    const rules = ctx.config.rules;
    const contenders = rules.discardPolicy === 'redistribute_confirmed' ? ctx.confirmed : ctx.all;
    const distribution = contenders.length
      ? split(
          available(ctx.pool),
          contenders.map((c) => c.id),
          seed
        )
      : { baseClp: 0, residualClp: 0, extraCandidateIds: [], shares: [] };
    const confirmedIds = new Set(ctx.confirmed.map((c) => c.id));
    const allocatedClp = distribution.shares
      .filter((s) => confirmedIds.has(s.candidateId))
      .reduce((sum, s) => sum + s.amountClp, 0);
    const remainderClp = available(ctx.pool) - allocatedClp;
    const disposition = ctx.exhausted
      ? 'keep_unassigned_exhausted'
      : !remainderClp
        ? 'fully_allocated'
        : !ctx.confirmed.length && rules.noResponsePolicy === 'advance_keep_unassigned'
          ? 'keep_unassigned'
          : 'redispute';
    const [proposal] = await M.PrizeProposal.create(
      [
        {
          editionId: edition._id,
          poolId: ctx.pool._id,
          resultId: ctx.result._id,
          cycle: ctx.result.allocationCycle || 0,
          snapshotHash: fingerprint(ctx.basis),
          basis: ctx.basis,
          accounts: ctx.accounts,
          split: distribution,
          seed,
          algorithm: 'hmac-sha256-fisher-yates-rejection-v1',
          allocatedClp,
          remainderClp,
          disposition,
          preparedBy: command.actorId,
          reason: command.input.reason.trim()
        }
      ],
      { session }
    );
    return { proposalId: proposal.id, version: edition.version };
  });
}
async function promoteOrOpen(edition, result, rules, actorId, session) {
  result.allocationCycle = (result.allocationCycle || 0) + 1;
  const reserves = await M.Candidate.find({
    editionId: edition._id,
    roundId: result.roundId,
    figure: result.figure,
    cohort: 'reserve',
    state: 'detected'
  }).session(session);
  // The draw's official sequence, never candidate insertion/contact order, defines the next tied group.
  const draws = await M.Draw.find({
    _id: { $in: reserves.map((c) => c.drawId) },
    editionId: edition._id
  }).session(session);
  const seq = new Map(draws.map((d) => [sid(d._id), d.sequence]));
  if (reserves.some((c) => !seq.has(sid(c.drawId)))) throw fail('prize_group');
  const first = reserves.length ? Math.min(...reserves.map((c) => seq.get(sid(c.drawId)))) : null;
  const group = reserves.filter((c) => seq.get(sid(c.drawId)) === first);
  for (const c of group) {
    c.cohort = 'primary';
    c.allocationCycle = result.allocationCycle;
    c.promotedAt = new Date();
    await c.save({ session });
  }
  result.state = group.length ? 'detected' : 'open';
  result.primaryCandidateCount = group.length;
  result.reserveCandidateCount = reserves.length - group.length;
  result.firstSequence = first || undefined;
  result.firstDrawId = group.length ? group[0].drawId : undefined;
  if (group.length) {
    await M.ContactEvent.insertMany(
      group.map((c) => ({
        editionId: edition._id,
        candidateId: c._id,
        actorId,
        action: 'reserve_promoted',
        occurredAt: new Date(),
        previousState: 'detected',
        nextState: 'detected'
      })),
      { session }
    );
  }
  if (rules.pauseDuringContact && group.length) {
    const round = await M.Round.findById(result.roundId).session(session);
    if (sid(edition.currentRoundId) !== sid(round._id) || edition.state === 'finished')
      throw fail('prize_continuation_state');
    edition.state = 'paused';
    round.state = 'paused';
    round.pauseReason = 'candidates';
    await round.save({ session });
    await edition.save({ session });
  }
  await result.save({ session });
  return { cycle: result.allocationCycle, promoted: group.length, state: result.state };
}
async function confirm(command) {
  reason(command.input.reason);
  if (command.input.reviewed !== true) throw fail('prize_review');
  return execute({ ...command, action: 'prize.settled' }, async ({ edition, session }) => {
    const proposal = await M.PrizeProposal.findOne({
      _id: identifier(command.input.proposalId),
      editionId: edition._id
    })
      .select('+basis +accounts')
      .session(session);
    if (!proposal) throw failure(404, 'Proposal not found');
    if (proposal.confirmedAt) throw fail('prize_already_allocated');
    if (command.input.reviewedSnapshotHash !== proposal.snapshotHash) throw fail('prize_proposal_stale');
    await checkBudget(edition._id, session);
    if (proposal.disposition === 'keep_unassigned_exhausted' && command.input.exhaustionAcknowledged !== true)
      throw fail('prize_exhaustion_review');
    const ctx = await context(edition, proposal.resultId, session);
    if (fingerprint(ctx.basis) !== proposal.snapshotHash) throw fail('prize_proposal_stale');
    const winners = new Map(ctx.confirmed.map((c) => [c.id, c]));
    const before = available(ctx.pool);
    const contenders = ctx.config.rules.discardPolicy === 'redistribute_confirmed' ? ctx.confirmed : ctx.all;
    const expectedSplit = contenders.length
      ? split(
          before,
          contenders.map((c) => c.id),
          proposal.seed
        )
      : { baseClp: 0, residualClp: 0, extraCandidateIds: [], shares: [] };
    if (fingerprint(expectedSplit) !== fingerprint(proposal.split)) throw fail('prize_proposal_stale');
    const awards = proposal.split.shares
      .filter((s) => winners.has(s.candidateId) && s.amountClp > 0)
      .map((s) => {
        const c = winners.get(s.candidateId);
        return {
          editionId: edition._id,
          operationKey: `${proposal.id}-${c.id}`,
          candidateId: c._id,
          poolKey: ctx.pool.figure,
          poolId: ctx.pool._id,
          proposalId: proposal._id,
          participantId: c.participantId,
          figure: ctx.pool.figure,
          sourceRowId: undefined,
          allocationCycle: proposal.cycle,
          accountReference: proposal.accounts[sid(c.participantId)],
          amountClp: s.amountClp,
          state: 'confirmed',
          confirmedAt: new Date(),
          confirmedBy: command.actorId
        };
      });
    const sourceCards = await M.Card.find({
      _id: { $in: ctx.confirmed.map((c) => c.cardId) },
      editionId: edition._id
    }).session(session);
    for (const a of awards) {
      const c = winners.get(sid(a.candidateId)),
        card = sourceCards.find((card) => sid(card._id) === sid(c.cardId));
      if (!card || sid(card.participantId) !== sid(c.participantId)) throw fail('prize_group');
      a.sourceRowId = card.sourceRowId;
    }
    if (awards.length) await M.Award.insertMany(awards, { session });
    for (const candidate of ctx.all) {
      candidate.settledAt = new Date();
      candidate.settledProposalId = proposal._id;
      candidate.allocatedClp = awards.find((a) => sid(a.candidateId) === candidate.id)?.amountClp || 0;
      await candidate.save({ session });
    }
    ctx.pool.allocatedClp += proposal.allocatedClp;
    const unassigned = proposal.disposition.startsWith('keep_unassigned') ? proposal.remainderClp : 0;
    ctx.pool.unassignedClp += unassigned;
    await ctx.pool.save({ session });
    proposal.confirmedAt = new Date();
    proposal.confirmedBy = command.actorId;
    await proposal.save({ session });
    const previous = await M.PrizeSettlement.findOne({ poolId: ctx.pool._id })
      .sort({ createdAt: -1, _id: -1 })
      .session(session);
    await M.PrizeSettlement.create(
      [
        {
          editionId: edition._id,
          poolId: ctx.pool._id,
          proposalId: proposal._id,
          resultId: ctx.result._id,
          cycle: proposal.cycle,
          availableBeforeClp: before,
          allocatedClp: proposal.allocatedClp,
          unassignedClp: unassigned,
          availableAfterClp: available(ctx.pool),
          disposition: proposal.disposition,
          sourceProposalId: previous ? previous.proposalId : undefined,
          reason: command.input.reason.trim(),
          actorId: command.actorId,
          occurredAt: new Date()
        }
      ],
      { session }
    );
    let continuation = null;
    if (proposal.disposition === 'redispute') {
      if (edition.state === 'finished' || sid(edition.currentRoundId) !== sid(ctx.result.roundId))
        throw fail('prize_continuation_state');
      continuation = await promoteOrOpen(edition, ctx.result, ctx.config.rules, command.actorId, session);
    } else {
      ctx.result.state = proposal.disposition.startsWith('keep_unassigned') ? 'unassigned' : 'adjudicated';
      await ctx.result.save({ session });
    }
    await checkBudget(edition._id, session);
    return {
      version: edition.version,
      proposalId: proposal.id,
      allocatedClp: proposal.allocatedClp,
      remainderClp: proposal.remainderClp,
      disposition: proposal.disposition,
      continuation
    };
  });
}
async function reopenRound(command) {
  reason(command.input.reason);
  if (command.input.reviewed !== true) throw fail('prize_review');
  return execute({ ...command, action: 'prize.round_reopened' }, async ({ edition, session }) => {
    if (edition.state !== 'finished' || !edition.currentRoundId) throw fail('prize_continuation_state');
    const round = await M.Round.findOne({
      _id: edition.currentRoundId,
      editionId: edition._id,
      state: 'finished'
    }).session(session);
    const result =
      round &&
      (await M.FigureResult.findOne({
        editionId: edition._id,
        roundId: round._id,
        state: { $in: ['open', 'detected'] }
      }).session(session));
    if (!result) throw fail('prize_continuation_state');
    await ensurePools(edition._id, session);
    await checkBudget(edition._id, session);
    const pool = await M.PrizePool.findOne({ editionId: edition._id, figure: result.figure }).session(
      session
    );
    if (!pool || available(pool) <= 0) throw fail('prize_continuation_state');
    edition.state = 'paused';
    edition.gameFinishedAt = undefined;
    round.state = 'paused';
    round.finishedAt = undefined;
    round.pauseReason = 'prize_recovery';
    await edition.save({ session });
    await round.save({ session });
    await M.GameIncident.create(
      [
        {
          editionId: edition._id,
          roundId: round._id,
          kind: 'recovery',
          operatorId: command.actorId,
          reason: command.input.reason.trim(),
          occurredAt: new Date()
        }
      ],
      { session }
    );
    return { version: edition.version, state: edition.state, roundId: round.id };
  });
}
async function credit(command) {
  const { awardId, amountClp, accountReference, reference, evidence, creditedAt, creditedToPolla } =
    command.input;
  if (
    creditedToPolla !== true ||
    typeof reference !== 'string' ||
    !reference.trim() ||
    reference.length > 200
  )
    throw fail('prize_credit');
  reason(evidence);
  if (
    typeof creditedAt !== 'string' ||
    !/(Z|[+-]\d\d:\d\d)$/.test(creditedAt) ||
    !Number.isFinite(Date.parse(creditedAt)) ||
    Date.parse(creditedAt) > Date.now()
  )
    throw fail('prize_credit_date');
  return execute({ ...command, action: 'prize.credit_recorded' }, async ({ edition, session }) => {
    const award = await M.Award.findOne({ _id: identifier(awardId), editionId: edition._id })
      .select('+accountReference')
      .session(session);
    if (!award) throw failure(404, 'Award not found');
    await checkBudget(edition._id, session);
    if (award.state !== 'confirmed' || !award.poolId) throw fail('prize_already_credited');
    if (
      amountClp !== award.amountClp ||
      accountReference !== award.accountReference ||
      Date.parse(creditedAt) < award.confirmedAt.getTime()
    )
      throw fail('prize_credit');
    const candidate = await M.Candidate.findOne({
      _id: award.candidateId,
      editionId: edition._id,
      state: 'confirmed'
    }).session(session);
    if (!candidate) throw fail('prize_response_evidence');
    const referenceHash = fingerprint(reference.trim().toLowerCase());
    if (await M.PrizeCredit.exists({ editionId: edition._id, referenceHash }).session(session))
      throw fail('prize_credit_duplicate');
    await M.PrizeCredit.create(
      [
        {
          editionId: edition._id,
          awardId: award._id,
          poolId: award.poolId,
          participantId: award.participantId,
          amountClp,
          accountReference,
          reference: reference.trim(),
          referenceHash,
          evidence: evidence.trim(),
          creditedAt: new Date(creditedAt),
          recordedAt: new Date(),
          recordedBy: command.actorId,
          destination: 'polla.cl'
        }
      ],
      { session }
    );
    award.state = 'delivered';
    award.deliveredAt = new Date(creditedAt);
    await award.save({ session });
    candidate.state = 'delivered';
    await candidate.save({ session });
    await M.PrizePool.updateOne({ _id: award.poolId }, { $inc: { deliveredClp: amountClp } }, { session });
    await audit(session, {
      editionId: edition._id,
      actorId: command.actorId,
      action: 'prize.credit_recorded',
      resourceId: award._id,
      version: edition.version
    });
    await checkBudget(edition._id, session);
    return { version: edition.version, awardId: award.id, state: 'delivered' };
  });
}
module.exports = {
  verifyAccount,
  prepare,
  confirm,
  credit,
  reopenRound,
  ensurePools,
  checkBudget,
  available
};
