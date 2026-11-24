const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'stage7-synthetic-secret';
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const M = require('../bingo-api/pilot/models');
const E = require('../bingo-api/pilot/game-engine');
const P = require('../bingo-api/pilot/prizes');
const G = require('../bingo-api/pilot/game');
const R = require('../bingo-api/pilot/prize-reports');
const { split } = require('../bingo-api/pilot/prize-split');
const { helpers } = require('./helpers/prize-fixture.cjs');
const { provision } = require('../bingo-api/pilot/staff');
const { createApp } = require('../server');
const oid = () => new mongoose.Types.ObjectId();
let replica, server, base, h, actorId;
const tokens = {};
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(replica.getUri());
  for (const role of ['administrator', 'operator', 'viewer', 'importer', 'auditor']) {
    const account = await provision({
      email: `${role}@example.invalid`,
      name: role,
      password: 'synthetic-password-123',
      roles: [role]
    });
    tokens[role] = (await mongoose.model('Admins').findById(account.id)).generateJwt();
    if (role === 'administrator') actorId = account.id;
  }
  h = helpers(actorId);
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/bingo-api/pilot/editions`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await db.disconnect();
  if (replica) await replica.stop();
});
async function http(id, tail = '', role = 'administrator', body) {
  const response = await fetch(`${base}/${id}/prizes${tail}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${tokens[role]}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `http-${oid()}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    body: response.headers.get('content-type').includes('json')
      ? await response.json()
      : await response.text()
  };
}
async function ready(extra = {}, count = 3, firstNumbers = [1], outcomes = []) {
  const id = await h.fixture(count, extra, firstNumbers);
  await h.ball(id, 1);
  return { id, result: await h.resolve(id, outcomes) };
}
async function totals(id) {
  return (await R.summary(id)).totals;
}
async function creditInput(id, award, reference = `credit-${oid()}`) {
  return h.command(id, {
    awardId: award.id,
    amountClp: award.amountClp,
    accountReference: award.accountReference,
    reference,
    evidence: 'Polla account credit receipt, synthetic; no actual money',
    creditedAt: new Date().toISOString(),
    creditedToPolla: true
  });
}
test('proposal requires every primary response reconciled and verified Polla ownership; imported identifier is not verification', async () => {
  const id = await h.fixture(2);
  await h.ball(id, 1);
  const result = await M.FigureResult.findOne({ editionId: id });
  await assert.rejects(h.prepare(id, result), (e) => e.publicCode === 'prize_pending_responses');
  const blockedHttp = await http(id, '/prepare', 'operator', {
    expectedVersion: (await M.Edition.findById(id)).version,
    resultId: result.id,
    reason: 'Synthetic pending response'
  });
  assert.equal(blockedHttp.body.code, 'prize_pending_responses');
  const rows = await M.Candidate.find({ editionId: id });
  const now = new Date(Date.now() - 120000);
  await M.Candidate.updateOne(
    { _id: rows[0]._id },
    {
      state: 'confirmed',
      contactStartedAt: now,
      expiresAt: new Date(now.getTime() + 60000),
      responseReceivedAt: now,
      resolvedAt: now,
      resolution: 'timely_response',
      responseEvidence: 'Synthetic channel proof',
      resolvedBy: actorId,
      contactedBy: actorId
    }
  );
  await assert.rejects(h.prepare(id, result), (e) => e.publicCode === 'prize_pending_responses');
  await M.Candidate.updateOne({ _id: rows[1]._id }, { state: 'discarded', resolution: 'no_timely_response' });
  await assert.rejects(h.prepare(id, result), (e) => e.publicCode === 'prize_account_missing');
  await assert.rejects(
    P.verifyAccount(
      await h.command(id, {
        participantId: rows[0].participantId.toString(),
        accountReference: 'original-external-id',
        verifiedWithPolla: false,
        evidence: 'Not verified'
      })
    ),
    (e) => e.publicCode === 'prize_account'
  );
});
test('validated distribution is exact, proposal seed cannot be rerolled, account frozen and replay never duplicates money', async () => {
  const { id, result } = await ready();
  const p = await h.prepare(id, result),
    again = await h.prepare(id, result);
  assert.equal(again.proposalId, p.proposalId);
  const stored = await M.PrizeProposal.findById(p.proposalId).select('+basis +accounts');
  assert.deepEqual(
    stored.split,
    split(
      300000,
      stored.basis.candidates.map((c) => c.id),
      stored.seed
    )
  );
  const participantId = stored.basis.candidates[0].participantId;
  await P.verifyAccount(
    await h.command(id, {
      participantId,
      accountReference: 'corrected-account',
      verifiedWithPolla: true,
      evidence: 'Correction before financial approval'
    })
  );
  await assert.rejects(
    P.confirm(
      await h.command(id, { proposalId: p.proposalId, reviewed: true, reason: 'Old account snapshot' })
    ),
    (e) => e.publicCode === 'prize_proposal_stale'
  );
  await h.prepare(id, result);
  await assert.rejects(
    P.confirm(
      await h.command(id, {
        proposalId: p.proposalId,
        reviewed: true,
        reviewedSnapshotHash: stored.snapshotHash,
        reason: 'Cannot approve another operator account correction without reviewing it'
      })
    ),
    (e) => e.publicCode === 'prize_proposal_stale'
  );
  const refreshed = await M.PrizeProposal.findById(p.proposalId);
  assert.equal(refreshed.seed, stored.seed);
  assert.deepEqual(refreshed.split, stored.split);
  const cmd = await h.command(id, {
    proposalId: p.proposalId,
    reviewed: true,
    reason: 'Validated complete synthetic tie'
  });
  assert.deepEqual(await P.confirm(cmd), await P.confirm(cmd));
  await assert.rejects(
    P.verifyAccount(
      await h.command(id, {
        participantId,
        accountReference: 'change-after-approval',
        verifiedWithPolla: true,
        evidence: 'Cannot redirect approved money'
      })
    ),
    (e) => e.publicCode === 'prize_account_locked'
  );
  const awards = await M.Award.find({ editionId: id });
  assert.equal(awards.length, 3);
  assert.equal(
    awards.reduce((sum, a) => sum + a.amountClp, 0),
    300000
  );
  assert.equal(await M.PrizeSettlement.countDocuments({ editionId: id }), 1);
  assert.equal((await totals(id)).allocatedClp, 300000);
  await assert.rejects(
    P.confirm(await h.command(id, cmd.input)),
    (e) => e.publicCode === 'prize_already_allocated'
  );
});
test('discard redistribution pays only timely responders, and pending report never includes discarded candidates', async () => {
  const { id, result } = await ready({}, 3, [1], ['confirmed', 'discarded', 'confirmed']);
  await h.settle(id, result);
  const awards = await M.Award.find({ editionId: id });
  assert.equal(awards.length, 2);
  assert.ok(awards.every((a) => a.amountClp === 150000));
  const pending = await R.report(id, 'pending'),
    discarded = await R.report(id, 'discarded');
  assert.equal(pending.total, 2);
  assert.equal(discarded.total, 1);
  assert.equal(discarded.rows[0].awardId, '');
  assert.equal(discarded.rows[0].amountClp, 0);
  assert.ok(!pending.rows.some((c) => c.candidateId === discarded.rows[0].candidateId));
});
test('no responses follow advance_keep_unassigned with no awards; redispute policy opens a new cycle instead', async () => {
  const one = await ready({}, 2, [1], ['discarded', 'discarded']);
  const settled = await h.settle(one.id, one.result);
  assert.equal(settled.disposition, 'keep_unassigned');
  assert.equal((await totals(one.id)).unassignedClp, 300000);
  assert.equal(await M.Award.countDocuments({ editionId: one.id }), 0);
  await G.nextRound(await h.command(one.id));
  const two = await ready({ noResponsePolicy: 'redispute_same_figure' }, 2, [1, 2], ['discarded']);
  const again = await h.settle(two.id, two.result);
  assert.equal(again.disposition, 'redispute');
  assert.equal(again.continuation.state, 'open');
  assert.equal(again.continuation.cycle, 1);
  assert.equal((await totals(two.id)).allocatedClp, 0);
  await h.ball(two.id, 2);
  const second = await h.resolve(two.id);
  await h.settle(two.id, second);
  assert.equal((await totals(two.id)).allocatedClp, 300000);
});
test('redispute_remainder conserves the discarded shares and promotes the entire earliest reserve draw', async () => {
  const id = await h.fixture(5, { discardPolicy: 'redispute_remainder' }, [1, 1, 2, 2, 3]);
  await h.ball(id, 1);
  await h.ball(id, 2);
  await h.ball(id, 3);
  const first = await h.resolve(id, ['confirmed', 'discarded']);
  const result = await h.settle(id, first);
  assert.equal(result.allocatedClp, 150000);
  assert.equal(result.remainderClp, 150000);
  assert.equal(result.continuation.promoted, 2);
  const promoted = await M.Candidate.find({ editionId: id, cohort: 'primary', allocationCycle: 1 });
  assert.equal(promoted.length, 2);
  assert.ok(promoted.every((c) => c.evidence.sequence === 2 && c.state === 'detected' && !c.expiresAt));
  assert.equal(await M.Candidate.countDocuments({ editionId: id, cohort: 'reserve' }), 1);
  const next = await h.resolve(id);
  await h.settle(id, next);
  const ledger = await totals(id);
  assert.equal(ledger.allocatedClp, 300000);
  assert.equal(ledger.availableClp, 100000);
  const history = await M.PrizeSettlement.find({ editionId: id }).sort({ createdAt: 1 });
  assert.equal(String(history[1].sourceProposalId), String(history[0].proposalId));
  assert.equal(history[1].availableBeforeClp, history[0].availableAfterClp);
  assert.equal(await M.Award.countDocuments({ editionId: id }), 3);
});
test('reserve promotion pauses when configured and gives newly eligible candidates a fresh individual minute', async () => {
  const id = await h.fixture(
    3,
    { discardPolicy: 'redispute_remainder', pauseDuringContact: true },
    [1, 1, 2]
  );
  await h.ball(id, 1);
  const result = await h.resolve(id, ['confirmed', 'discarded']);
  await G.resume(await h.command(id));
  await h.ball(id, 2);
  await h.settle(id, result);
  assert.equal((await M.Edition.findById(id)).state, 'paused');
  await assert.rejects(G.resume(await h.command(id)), (e) => e.publicCode === 'game_pending_contact');
  const reserve = await M.Candidate.findOne({ editionId: id, allocationCycle: 1 });
  assert.equal(reserve.expiresAt, undefined);
  await h.resolve(id);
  await G.resume(await h.command(id));
});
test('exhausted eligibility can only close unused balance after explicit exceptional review; no zero credit is created', async () => {
  const { id, result } = await ready({ noResponsePolicy: 'redispute_same_figure' }, 1, [1], ['discarded']);
  await h.settle(id, result);
  const open = await M.FigureResult.findById(result._id);
  const p = await h.prepare(id, open);
  const proposal = await M.PrizeProposal.findById(p.proposalId);
  assert.equal(proposal.disposition, 'keep_unassigned_exhausted');
  await assert.rejects(
    P.confirm(
      await h.command(id, { proposalId: p.proposalId, reason: 'No remaining eligible cards', reviewed: true })
    ),
    (e) => e.publicCode === 'prize_exhaustion_review'
  );
  await P.confirm(
    await h.command(id, {
      proposalId: p.proposalId,
      reason: 'Verified complete exhaustion; keep funds unassigned',
      reviewed: true,
      exhaustionAcknowledged: true
    })
  );
  assert.equal((await totals(id)).unassignedClp, 300000);
  assert.equal(await M.Award.countDocuments({ editionId: id }), 0);
  await G.nextRound(await h.command(id));
});
test('concurrent approvals and credits commit once, and duplicate credit references cannot spend a second award', async () => {
  const { id, result } = await ready({}, 2);
  const p = await h.prepare(id, result);
  const cmd = await h.command(id, {
    proposalId: p.proposalId,
    reviewed: true,
    reason: 'Complete validation'
  });
  const race = await Promise.allSettled([P.confirm(cmd), P.confirm({ ...cmd, key: `other-${oid()}` })]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  const awards = await M.Award.find({ editionId: id }).select('+accountReference');
  const input = await creditInput(id, awards[0], 'unique-operation');
  const same = await Promise.all([P.credit(input), P.credit(input)]);
  assert.deepEqual(same[0], same[1]);
  assert.equal(await M.PrizeCredit.countDocuments({ editionId: id }), 1);
  await assert.rejects(
    P.credit(await creditInput(id, awards[1], 'unique-operation')),
    (e) => e.publicCode === 'prize_credit_duplicate'
  );
  assert.equal((await totals(id)).deliveredClp, 150000);
});
test('credit requires full amount, original verified account, actual date and proof; it records only an external Polla credit', async () => {
  const { id, result } = await ready({}, 1);
  await h.settle(id, result);
  const award = await M.Award.findOne({ editionId: id }).select('+accountReference');
  for (const patch of [
    { amountClp: 49999 },
    { accountReference: 'wrong-account' },
    { creditedToPolla: false },
    { evidence: '' },
    { creditedAt: '2099-01-01T00:00:00Z' },
    { creditedAt: '2020-01-01T00:00:00Z' }
  ]) {
    const cmd = await creditInput(id, award);
    cmd.input = { ...cmd.input, ...patch };
    await assert.rejects(P.credit(cmd));
  }
  const cmd = await creditInput(id, award);
  await P.credit(cmd);
  await db.disconnect();
  await db.connect(replica.getUri());
  assert.equal((await P.credit(cmd)).state, 'delivered');
  assert.equal((await totals(id)).pendingCreditClp, 0);
  assert.equal((await M.Candidate.findById(award.candidateId)).state, 'delivered');
  const record = await M.PrizeCredit.findOne({ awardId: award._id });
  assert.equal(record.destination, 'polla.cl');
  assert.equal((await R.report(id, 'pending')).total, 0);
  assert.equal((await R.report(id, 'delivered')).total, 1);
  await assert.rejects(M.PrizeCredit.updateOne({ _id: record._id }, { amountClp: 1 }), /append-only/);
});
test('the live event (binguito then letra F) opens one simultaneous round where binguito completes first since its cells are a subset of letra F, settles both funded pools and finishes without ever detecting the idle figures', async () => {
  const figures = E.names.map((name) => ({
    name,
    poolClp: E.pools[name],
    mask:
      name === 'U'
        ? ['10000', '00000', '00000', '00000', '00000']
        : name === 'F'
          ? ['10001', '00000', '00000', '00000', '00000']
          : ['00000', '00000', '00000', '00000', '00001']
  }));
  const id = await h.fixture(1, { roundMode: 'simultaneous', figures }, undefined, [
    [1, 0],
    [2, 4]
  ]);
  assert.equal(await M.Round.countDocuments({ editionId: id }), 1);
  await h.ball(id, 1);
  const binguito = await h.resolve(id);
  assert.equal(binguito.figure, 'U');
  await h.settle(id, binguito);
  assert.equal((await totals(id)).allocatedClp, 100000);
  await h.ball(id, 2);
  const letraF = await h.resolve(id);
  assert.equal(letraF.figure, 'F');
  await h.settle(id, letraF);
  const sum = await totals(id);
  assert.equal(sum.allocatedClp, 400000);
  assert.equal(sum.availableClp, 0);
  assert.equal(await M.Round.countDocuments({ editionId: id }), 1);
  await G.finish(await h.command(id, { reason: 'Only binguito and letra F are played this event' }));
  assert.equal((await M.Edition.findById(id)).state, 'finished');
  const awards = await M.Award.find({ editionId: id }).select('+accountReference');
  for (const award of awards) await P.credit(await creditInput(id, award));
  assert.equal((await totals(id)).deliveredClp, 400000);
});
test('a figure with no pool this event blocks preparation instead of paying out money that was never budgeted', async () => {
  const figures = E.names.map((name) => ({
    name,
    poolClp: E.pools[name],
    mask:
      name === 'U'
        ? ['10000', '00000', '00000', '00000', '00000']
        : name === 'F'
          ? ['10001', '00000', '00000', '00000', '00000']
          : name === 'A'
            ? ['00000', '00000', '00000', '00000', '00001']
            : ['00000', '00000', '00000', '10000', '00000']
  }));
  const id = await h.fixture(1, { roundMode: 'simultaneous', figures }, undefined, [
    [1, 0],
    [2, 4],
    [3, 24],
    [75, 15]
  ]);
  await h.ball(id, 1);
  await h.settle(id, await h.resolve(id));
  await h.ball(id, 2);
  await h.settle(id, await h.resolve(id));
  await h.ball(id, 3);
  const idleFigure = await h.resolve(id);
  assert.equal(idleFigure.figure, 'A');
  await assert.rejects(h.prepare(id, idleFigure), (e) => e.publicCode === 'prize_budget');
});
test('unsettled monetary result prevents next round even if contacts are resolved; corrupt ledger and proposal block atomically', async () => {
  const { id, result } = await ready({}, 1);
  await assert.rejects(G.nextRound(await h.command(id)), (e) => e.publicCode === 'prize_pending_settlement');
  const p = await h.prepare(id, result);
  await M.PrizeProposal.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(p.proposalId) },
    { $set: { 'split.shares.0.amountClp': 50001 } }
  );
  await assert.rejects(
    P.confirm(
      await h.command(id, { proposalId: p.proposalId, reviewed: true, reason: 'Reject altered proposal' })
    ),
    (e) => e.publicCode === 'prize_proposal_stale'
  );
  assert.equal(await M.Award.countDocuments({ editionId: id }), 0);
  await M.PrizePool.updateOne({ editionId: id, figure: 'F' }, { $set: { allocatedClp: 50001 } });
  await assert.rejects(R.summary(id), (e) => e.publicCode === 'prize_budget');
});
test('reports isolate contacts, evidence and Polla references; exports are distinct, complete and safe for spreadsheets', async () => {
  const { id, result } = await ready({}, 3, [1], ['confirmed', 'discarded', 'confirmed']);
  await h.settle(id, result);
  const summary = await http(id, '', 'viewer');
  assert.equal(summary.status, 200);
  assert.ok(!JSON.stringify(summary.body).includes('@example.invalid'));
  assert.equal((await http(id, '/reports/pending', 'viewer')).status, 403);
  assert.equal((await http(id, '/reports/pending', 'importer')).status, 403);
  assert.equal((await http(id, '/reports/pending?format=csv', 'operator')).status, 403);
  const csv = await http(id, '/reports/pending?format=csv', 'auditor');
  assert.equal(csv.status, 200);
  assert.ok(csv.body.includes('polla.cl'));
  const discarded = await http(id, '/reports/discarded', 'auditor');
  assert.equal(discarded.body.total, 1);
  const pending = await http(id, '/reports/pending?limit=1', 'operator');
  assert.equal(pending.body.total, 2);
  assert.equal(pending.body.rows.length, 1);
  assert.equal((await http(id, '/reports/pending?limit=101')).status, 400);
  const other = await h.fixture(1),
    award = await M.Award.findOne({ editionId: id });
  assert.equal(
    (
      await http(other, '/credits', 'operator', {
        expectedVersion: (await M.Edition.findById(other)).version,
        awardId: award.id,
        amountClp: award.amountClp,
        accountReference: 'other',
        reference: 'other',
        evidence: 'Other edition',
        creditedAt: new Date().toISOString(),
        creditedToPolla: true
      })
    ).status,
    404
  );
  const proposal = await M.PrizeProposal.findOne({ editionId: id });
  assert.equal((await http(other, `/proposals/${proposal.id}`, 'operator')).status, 404);
  const encoded = R.csv([
    { name: '=HYPERLINK("bad")', email: '+formula', phone: '+56911111111', responseEvidence: '  @command' }
  ]);
  assert.ok(encoded.includes("'=HYPERLINK"));
  assert.ok(encoded.includes("'+569"));
  assert.ok(encoded.includes("'  @command"));
  const audit = await M.Audit.find({ editionId: id }).lean();
  assert.ok(audit.some((a) => a.action === 'prize.report_exported'));
  assert.ok(!JSON.stringify(audit).includes('polla-'));
});

test('repeated redisputes conserve every peso down to a one-peso balance; zero shares are not pending credits', async () => {
  const numbers = Array.from({ length: 30 }, (_, i) => [i + 1, i + 1])
    .flat()
    .concat([31, 31, 31]);
  const id = await h.fixture(numbers.length, { discardPolicy: 'redispute_remainder' }, numbers);
  let n = 1;
  while (true) {
    await h.ball(id, n++);
    const result = await h.resolve(id, ['confirmed', 'discarded']);
    const settled = await h.settle(id, result);
    assert.ok((await totals(id)).allocatedClp <= 300000);
    if (settled.remainderClp === 1) break;
    assert.ok(n < 25);
  }
  await h.ball(id, 31);
  const result = await h.resolve(id);
  await h.settle(id, result);
  const report = await R.report(id, 'confirmed');
  assert.equal(report.rows.filter((r) => r.awardState === 'no_credit_due').length, 2);
  assert.equal((await totals(id)).allocatedClp, 300000);
  assert.equal(await M.Award.countDocuments({ editionId: id, amountClp: 0 }), 0);
  assert.ok((await R.report(id, 'pending')).rows.every((r) => r.amountClp > 0));
});
test('failed continuation rolls back awards, ledger, settlement and proposal approval together', async () => {
  const { id, result } = await ready(
    { discardPolicy: 'redispute_remainder' },
    2,
    [1],
    ['confirmed', 'discarded']
  );
  const proposal = await h.prepare(id, result);
  await assert.rejects(
    G.finish(await h.command(id, { reason: 'Cannot finish with a monetary result pending' })),
    (e) => e.publicCode === 'prize_pending_settlement'
  );
  // Inject a stopped round from the previous version to exercise rollback and recovery.
  const edition = await M.Edition.findById(id);
  await M.Edition.updateOne({ _id: id }, { state: 'finished' });
  await M.Round.updateOne({ _id: edition.currentRoundId }, { state: 'finished' });
  await assert.rejects(
    P.confirm(
      await h.command(id, {
        proposalId: proposal.proposalId,
        reviewed: true,
        reason: 'Cannot redispute a stopped round'
      })
    ),
    (e) => e.publicCode === 'prize_continuation_state'
  );
  assert.equal(await M.Award.countDocuments({ editionId: id }), 0);
  assert.equal(await M.PrizeSettlement.countDocuments({ editionId: id }), 0);
  assert.equal((await totals(id)).allocatedClp, 0);
  assert.equal((await M.PrizeProposal.findById(proposal.proposalId)).confirmedAt, undefined);
  await P.reopenRound(
    await h.command(id, {
      reviewed: true,
      reason: 'Recover a previous-version stopped round with unresolved money'
    })
  );
  assert.equal((await M.Edition.findById(id)).state, 'paused');
  await P.confirm(
    await h.command(id, {
      proposalId: proposal.proposalId,
      reviewed: true,
      reason: 'Reviewed money after recovery'
    })
  );
  assert.equal((await totals(id)).allocatedClp, 150000);
});

test('simultaneous figures settle independently and processing figures in reverse order preserves winners and the 400000 ceiling', async () => {
  const snapshots = [];
  // Only F and U are funded this event; give the five $0 figures a cell this fixture's single
  // ball never draws, so they stay open instead of detecting a completion nobody budgeted for.
  const figures = E.names.map((name) => ({
    name,
    poolClp: E.pools[name],
    mask: ['F', 'U'].includes(name)
      ? ['10000', '00000', '00100', '00000', '00000']
      : ['00000', '00000', '00100', '00000', '00001']
  }));
  for (const reverse of [false, true]) {
    const id = await h.fixture(2, { roundMode: 'simultaneous', figures });
    await h.ball(id, 1);
    let results = await M.FigureResult.find({ editionId: id, state: { $ne: 'open' } }).sort({ figure: 1 });
    assert.equal(results.length, 2);
    if (reverse) results = results.reverse();
    for (const result of results) await h.settle(id, await h.resolve(id, [], result.id));
    assert.equal((await totals(id)).allocatedClp, 400000);
    const report = await R.report(id, 'awards');
    snapshots.push(report.rows.map((r) => [r.externalId, r.figure, r.amountClp].join(':')).sort());
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
});

test('HTTP approval binds to the reviewed snapshot and records a full Polla credit without provider calls', async () => {
  const { id, result } = await ready({}, 1);
  let expectedVersion = (await M.Edition.findById(id)).version;
  const prepared = await http(id, '/prepare', 'operator', {
    expectedVersion,
    resultId: result.id,
    reason: 'HTTP distribution review'
  });
  assert.equal(prepared.status, 200);
  const proposal = (await http(id, '/proposals/' + prepared.body.proposalId, 'operator')).body;
  expectedVersion = prepared.body.version;
  assert.equal(
    (
      await http(id, '/confirm', 'importer', {
        expectedVersion,
        proposalId: proposal._id,
        reason: 'Cannot approve as importer',
        reviewed: true,
        reviewedSnapshotHash: proposal.snapshotHash
      })
    ).status,
    403
  );
  assert.equal(
    (
      await http(id, '/confirm', 'operator', {
        expectedVersion,
        proposalId: proposal._id,
        reason: 'Reject stale view',
        reviewed: true,
        reviewedSnapshotHash: 'old-view'
      })
    ).status,
    409
  );
  const approved = await http(id, '/confirm', 'operator', {
    expectedVersion,
    proposalId: proposal._id,
    reason: 'Reviewed exact proposal, accounts and full budget',
    reviewed: true,
    reviewedSnapshotHash: proposal.snapshotHash
  });
  assert.equal(approved.status, 200);
  const award = await M.Award.findOne({ editionId: id }).select('+accountReference');
  const command = await creditInput(id, award);
  const recorded = await http(id, '/credits', 'operator', {
    expectedVersion: command.expectedVersion,
    ...command.input
  });
  assert.equal(recorded.status, 200);
  const summary = await http(id, '', 'viewer');
  assert.equal(summary.body.totals.deliveredClp, 300000);
  assert.ok(!JSON.stringify(summary.body).includes(award.accountReference));
});
