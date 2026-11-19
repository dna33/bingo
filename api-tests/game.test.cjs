const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const { once } = require('node:events');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'stage5-synthetic-secret';
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const M = require('../bingo-api/pilot/models');
const { provision } = require('../bingo-api/pilot/staff');
const { createEdition } = require('../bingo-api/pilot/persistence');
const I = require('../bingo-api/pilot/imports');
const C = require('../bingo-api/pilot/cards');
const G = require('../bingo-api/pilot/game');
const E = require('../bingo-api/pilot/game-engine');
const { generateCells } = require('../bingo-api/pilot/card-generator');
const { createApp } = require('../server');
const oid = () => new mongoose.Types.ObjectId();
let replica, server, base, actorId;
const tokens = {};
const gameRules = (extra = {}) => ({
  roundMode: 'independent',
  extractionMode: 'manual',
  order: E.names,
  repeatWinners: true,
  pauseDuringContact: false,
  roundingPolicy: 'auditable_residual_draw',
  discardPolicy: 'redistribute_confirmed',
  noResponsePolicy: 'advance_keep_unassigned',
  contactClockStart: 'operator_confirms_notice',
  maskReviewConfirmed: true,
  confirmationReference: 'Synthetic rules, not final pilot approval',
  figures: E.names.map((name) => ({
    name,
    poolClp: E.pools[name],
    mask: ['10000', '00000', '00100', '00000', '00000']
  })),
  ...extra
});
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(replica.getUri());
  for (const role of ['administrator', 'operator', 'viewer', 'importer']) {
    const account = await provision({
      email: `${role}@example.invalid`,
      name: role,
      password: 'synthetic-password-123',
      roles: [role]
    });
    tokens[role] = (await mongoose.model('Admins').findById(account.id)).generateJwt();
    if (role === 'administrator') actorId = account.id;
  }
  const secondOperator = await provision({
    email: 'operator2@example.invalid',
    name: 'Second operator',
    password: 'synthetic-password-123',
    roles: ['operator']
  });
  tokens.operator2 = (await mongoose.model('Admins').findById(secondOperator.id)).generateJwt();
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/bingo-api/pilot/editions`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.disconnect();
  if (replica) await replica.stop();
});
async function command(editionId, input = {}) {
  return {
    editionId,
    actorId,
    key: `game-${oid()}`,
    expectedVersion: (await M.Edition.findById(editionId)).version,
    input
  };
}
async function fixture(count = 2, rules = gameRules(), firstNumbers = [1], close = true) {
  const editionId = oid();
  await createEdition({ editionId, actorId, name: 'Stage 5 synthetic edition' });
  const csv =
    'email,telefono,jugador_id\n' +
    Array.from(
      { length: count },
      (_, i) => `player${i}@example.invalid,+569${String(i).padStart(8, '0')},id-${i}`
    ).join('\n');
  const file = await I.stageImport(
    await command(editionId, {
      filename: 'synthetic.csv',
      contentBase64: Buffer.from(csv).toString('base64'),
      sourceReference: 'Synthetic Polla list'
    })
  );
  await I.applyImport(await command(editionId, { importId: file.importId }));
  await C.configureCards(
    await command(editionId, {
      settings: {
        minNumber: 1,
        maxNumber: 75,
        columnMode: 'unrestricted',
        confirmationReference: 'Synthetic variant'
      }
    })
  );
  let n = 0,
    remaining = count;
  const generate = (settings) => {
    const cells = generateCells(settings),
      number = firstNumbers[n++ % firstNumbers.length],
      old = cells.indexOf(number);
    if (old >= 0) [cells[old], cells[0]] = [cells[0], cells[old]];
    else cells[0] = number;
    return cells;
  };
  while (remaining)
    remaining = (await C.issueBatch(await command(editionId, { limit: 100 }), { generate })).remaining;
  if (close) await I.closeList(await command(editionId));
  if (rules) await G.configure(await command(editionId, { settings: rules }));
  return editionId;
}
async function start(editionId) {
  await G.prepare(await command(editionId));
  return G.start(await command(editionId));
}
async function ball(editionId, number) {
  return G.draw(
    await command(editionId, {
      roundId: String((await M.Edition.findById(editionId)).currentRoundId),
      ...(number === undefined ? {} : { number })
    })
  );
}
async function http(editionId, route = '', role = 'administrator', body, key = `http-${oid()}`) {
  const response = await fetch(`${base}/${editionId}/game${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${tokens[role]}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, data: await response.json() };
}
test('ready requires reviewed complete rules, closed reconciliation and intact PDFs; sending is not an eligibility requirement', async () => {
  const id = await fixture(1, null, [1], false);
  await assert.rejects(G.prepare(await command(id)), (e) => e.publicCode === 'game_configuration_required');
  await G.configure(await command(id, { settings: gameRules() }));
  await assert.rejects(G.prepare(await command(id)), (e) => e.publicCode === 'reconciliation_incomplete');
  await I.closeList(await command(id));
  const pdf = await M.CardPdf.findOne({ editionId: id }).select('+bytes');
  await M.CardPdf.collection.updateOne({ _id: pdf._id }, { $set: { bytes: Buffer.from('broken') } });
  await assert.rejects(G.prepare(await command(id)), (e) => e.publicCode === 'pdf_integrity');
  assert.equal(await M.GameRoster.countDocuments({ editionId: id }), 0);
  await M.CardPdf.collection.updateOne({ _id: pdf._id }, { $set: { bytes: Buffer.from(pdf.bytes) } });
  assert.equal((await G.prepare(await command(id))).state, 'ready');
  assert.equal(await M.Delivery.countDocuments({ editionId: id }), 0);
});
test('manual states and validation reject invalid/duplicate numbers without changing history; incidents pause safely', async () => {
  const id = await fixture(1);
  await start(id);
  await assert.rejects(ball(id, 0), (e) => e.status === 400);
  await assert.rejects(ball(id, 76), (e) => e.status === 400);
  const first = await ball(id, 2);
  assert.equal(first.sequence, 1);
  await assert.rejects(ball(id, 2), (e) => e.publicCode === 'game_duplicate');
  await G.pause(await command(id));
  await assert.rejects(ball(id, 3), (e) => e.status === 409);
  await G.resume(await command(id));
  await G.incident(
    await command(id, {
      kind: 'entry_error',
      drawId: first.drawId,
      reason: 'Synthetic review; keep the original sequence'
    })
  );
  assert.equal((await M.Edition.findById(id)).state, 'paused');
  assert.equal(await M.Draw.countDocuments({ editionId: id }), 1);
  await G.resume(await command(id));
  await G.finish(await command(id, { reason: 'Synthetic end' }));
  assert.equal((await M.Edition.findById(id)).state, 'finished');
  await assert.rejects(G.resume(await command(id)), (e) => e.publicCode === 'game_state');
});
test('all tied cards are detected together with evidence even with no player session; roster is frozen', async () => {
  const id = await fixture(3);
  const delivery = require('../bingo-api/pilot/deliveries');
  await delivery.enqueue(await command(id, { channel: 'email', simulation: 'permanent_failure' }));
  let tick = Date.now() + 1000;
  await delivery.processBatch(id, { now: () => new Date((tick += 110)) });
  assert.equal(await M.Delivery.countDocuments({ editionId: id, state: 'failed' }), 3);
  await start(id);
  const before = await M.GameRoster.find({ editionId: id }).lean();
  await M.Participant.updateOne({ _id: before[0].participantId }, { active: false });
  const drawn = await ball(id, 1);
  assert.equal(drawn.candidateCount, 3);
  const candidates = await M.Candidate.find({ editionId: id });
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((c) => c.state === 'detected' && c.cohort === 'primary'));
  assert.ok(
    candidates.every(
      (c) => c.evidence.sequence === 1 && c.evidence.number === 1 && c.evidence.mask[2][2] === '1'
    )
  );
  const result = await M.FigureResult.findOne({ editionId: id, figure: 'F' });
  assert.equal(result.primaryCandidateCount, 3);
  assert.equal(await M.Award.countDocuments({ editionId: id }), 0);
});
test('later completions are reserve candidates, and an adjudicated figure receives no later additions', async () => {
  const rules = gameRules();
  rules.figures = rules.figures.map((f) => (f.name === 'F' ? f : { ...f, mask: Array(5).fill('11111') }));
  const id = await fixture(3, rules, [1, 2, 3]);
  await start(id);
  assert.equal((await ball(id, 1)).candidateCount, 1);
  assert.equal((await ball(id, 2)).candidateCount, 1);
  const result = await M.FigureResult.findOne({ editionId: id, figure: 'F' });
  assert.equal(result.primaryCandidateCount, 1);
  assert.equal(result.reserveCandidateCount, 1);
  // Stage 7 will own this transition; inject it only to verify the motor's boundary.
  await M.FigureResult.updateOne({ _id: result._id }, { state: 'adjudicated' });
  assert.equal((await ball(id, 3)).candidateCount, 0);
  assert.equal(await M.Candidate.countDocuments({ editionId: id, cohort: 'reserve' }), 1);
});
test('simultaneous figures retain every tie from a draw; contact-pause prevents bypassing unresolved candidates', async () => {
  const id = await fixture(2, gameRules({ roundMode: 'simultaneous', pauseDuringContact: true }));
  await start(id);
  assert.equal((await ball(id, 1)).candidateCount, 14);
  assert.equal((await M.Edition.findById(id)).state, 'paused');
  assert.equal(await M.FigureResult.countDocuments({ editionId: id, primaryCandidateCount: 2 }), 7);
  await assert.rejects(G.resume(await command(id)), (e) => e.publicCode === 'game_pending_contact');
  await assert.rejects(ball(id, 2), (e) => e.status === 409);
});
test('independent rounds return all balls, clear derived marks and keep card/PDF identity and the free center', async () => {
  const id = await fixture(1);
  await start(id);
  const card = await M.Card.findOne({ editionId: id }),
    pdf = await M.CardPdf.findOne({ cardId: card._id }).select('+bytes');
  const originalRound = (await M.Edition.findById(id)).currentRoundId;
  await ball(id, 1);
  const money = require('./helpers/prize-fixture.cjs').helpers(actorId);
  await money.settle(id, await money.resolve(id));
  const opened = await G.nextRound(await command(id));
  const round = await M.Round.findById(opened.roundId);
  assert.equal(round.ordinal, 1);
  assert.deepEqual(round.figures.toObject(), ['A']);
  assert.equal(round.lastSequence, 0);
  assert.equal(round.progress[0].nearCards[0].missingNumbers[0], 1);
  assert.deepEqual(round.progress[0].nearCards[0].matchedPositions, [12]);
  assert.equal((await ball(id, 1)).sequence, 1);
  assert.equal(await M.Draw.countDocuments({ roundId: originalRound }), 1);
  assert.deepEqual((await M.Card.findById(card.id)).cells.toObject(), card.cells.toObject());
  assert.ok((await M.CardPdf.findById(pdf.id).select('+bytes')).bytes.equals(pdf.bytes));
});
test('disallowing repeat winners waits for primary resolution and excludes confirmed prior winners', async () => {
  const id = await fixture(2, gameRules({ repeatWinners: false }));
  await start(id);
  await ball(id, 1);
  await assert.rejects(G.nextRound(await command(id)), (e) => e.publicCode === 'game_pending_contact');
  const candidates = await M.Candidate.find({ editionId: id }).sort({ _id: 1 });
  const money = require('./helpers/prize-fixture.cjs').helpers(actorId);
  await money.settle(id, await money.resolve(id, ['confirmed', 'discarded']));
  await G.nextRound(await command(id));
  assert.equal((await ball(id, 1)).candidateCount, 1);
  const second = await M.Candidate.findOne({ editionId: id, figure: 'A' });
  assert.equal(String(second.participantId), String(candidates[1].participantId));
});
test('digital drawing is without replacement, rejects supplied numbers and recovers the same receipt after reconnect', async () => {
  const id = await fixture(1, gameRules({ extractionMode: 'digital' }));
  await start(id);
  await assert.rejects(ball(id, 1), (e) => e.publicCode === 'game_digital_number');
  const request = await command(id, { roundId: String((await M.Edition.findById(id)).currentRoundId) });
  const first = await G.draw(request);
  const uri = replica.getUri();
  await db.disconnect();
  await db.connect(uri);
  assert.deepEqual(await G.draw(request), first);
  for (let i = 1; i < 75; i++) await ball(id);
  const draws = await M.Draw.find({ editionId: id }).sort({ sequence: 1 });
  assert.equal(new Set(draws.map((d) => d.number)).size, 75);
  assert.ok(draws.every((d) => d.origin === 'digital' && d.evaluationComplete));
  await assert.rejects(ball(id), (e) => e.publicCode === 'game_exhausted');
});
test('concurrent actions serialize across versions and retries do not duplicate official numbers or results', async () => {
  const id = await fixture(2);
  await start(id);
  const request = await command(id, {
    roundId: String((await M.Edition.findById(id)).currentRoundId),
    number: 1
  });
  const same = await Promise.all([G.draw(request), G.draw(request)]);
  assert.deepEqual(same[0], same[1]);
  assert.equal(await M.Draw.countDocuments({ editionId: id }), 1);
  assert.equal(await M.Candidate.countDocuments({ editionId: id }), 2);
  const next = await command(id, { roundId: request.input.roundId, number: 2 });
  const races = await Promise.all([
    http(id, '/draw', 'operator', {
      expectedVersion: next.expectedVersion,
      roundId: request.input.roundId,
      number: 2
    }),
    http(id, '/draw', 'operator2', {
      expectedVersion: next.expectedVersion,
      roundId: request.input.roundId,
      number: 3
    })
  ]);
  assert.deepEqual(races.map((result) => result.status).sort(), [200, 409]);
  assert.equal(await M.Draw.countDocuments({ editionId: id }), 2);
});
test('a failure after figure detection rolls back the draw, cohort counters, evidence and version', async () => {
  const id = await fixture(2);
  await start(id);
  const card = await M.Card.findOne({ editionId: id }).lean();
  await M.Card.collection.deleteOne({ _id: card._id });
  const request = await command(id, {
    roundId: String((await M.Edition.findById(id)).currentRoundId),
    number: 1
  });
  await assert.rejects(G.draw(request), (e) => e.status === 400);
  assert.equal(await M.Draw.countDocuments({ editionId: id }), 0);
  assert.equal(await M.Candidate.countDocuments({ editionId: id }), 0);
  assert.equal((await M.FigureResult.findOne({ editionId: id })).state, 'open');
  assert.equal((await M.Edition.findById(id)).version, request.expectedVersion);
  await M.Card.collection.insertOne(card);
  assert.equal((await G.draw(request)).candidateCount, 2);
});
test('HTTP permissions and privacy protect configuration, operation, candidate contacts and incidents', async () => {
  const id = await fixture(1);
  const version = (await M.Edition.findById(id)).version;
  assert.equal((await http(id, '/prepare', 'viewer', { expectedVersion: version })).status, 403);
  assert.equal(
    (await http(id, '/configure', 'operator', { expectedVersion: version, settings: gameRules() })).status,
    403
  );
  const ready = await http(id, '/prepare', 'operator', { expectedVersion: version });
  assert.equal(ready.status, 200);
  const started = await http(id, '/start', 'operator', { expectedVersion: ready.data.version });
  assert.equal(started.status, 200);
  const drawn = await http(id, '/draw', 'operator', {
    expectedVersion: started.data.version,
    roundId: started.data.roundId,
    number: 1
  });
  assert.equal(drawn.status, 200);
  const snapshot = await http(id, '', 'viewer');
  assert.equal(snapshot.data.round.lastSequence, 1);
  assert.ok(!JSON.stringify(snapshot.data).includes('player0@example.invalid'));
  const list = await http(id, '/candidates?cohort=primary', 'viewer');
  assert.equal(list.data.length, 1);
  const candidateId = list.data[0]._id;
  assert.equal((await http(id, `/candidates/${candidateId}/contact`, 'viewer')).status, 403);
  assert.deepEqual(
    (await http(id, `/candidates/${candidateId}/contact`, 'operator')).data.emails,
    ['player0@example.invalid']
  );
  assert.equal((await http(id, '/incidents', 'viewer')).status, 403);
  const other = await fixture(1);
  assert.equal((await http(other, `/candidates/${candidateId}/contact`, 'operator')).status, 404);
  assert.equal((await http(id, '/candidates?limit=9999', 'viewer')).status, 400);
});
test(
  '3000 cards are evaluated atomically and every same-draw candidate is persisted; report reproducible HTTP timings',
  { timeout: 120000 },
  async () => {
    const id = await fixture(3000);
    await start(id);
    const durations = [];
    let version = (await M.Edition.findById(id)).version;
    const roundId = String((await M.Edition.findById(id)).currentRoundId);
    for (let n = 1; n <= 25; n++) {
      const t = performance.now();
      const drawn = await http(id, '/draw', 'operator', { expectedVersion: version, roundId, number: n });
      assert.equal(drawn.status, 200);
      version = drawn.data.version;
      const frame = await http(id, '', 'viewer');
      assert.equal(frame.data.round.lastSequence, n);
      durations.push(performance.now() - t);
      if (n === 1) {
        assert.equal(drawn.data.candidateCount, 3000);
        assert.equal(frame.data.results[0].primaryCandidateCount, 3000);
      }
    }
    assert.equal(await M.Candidate.countDocuments({ editionId: id, cohort: 'primary' }), 3000);
    assert.equal(await M.Candidate.countDocuments({ editionId: id, cohort: 'reserve' }), 0);
    assert.ok(
      (await M.Draw.find({ editionId: id })).every((d) => d.evaluatedCards === 3000 && d.evaluationComplete)
    );
    const sorted = [...durations].sort((a, b) => a - b);
    console.log(
      'GAME_LOAD_METRICS',
      JSON.stringify({
        cards: 3000,
        activeFigures: 1,
        draws: 25,
        p95HttpMs: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
        maxHttpMs: Math.round(sorted[sorted.length - 1]),
        firstTieHttpMs: Math.round(durations[0])
      })
    );
  }
);

test('all seven independent rounds follow the configured order with one O and exactly seven first-cohort results', async () => {
  const id = await fixture(1);
  await start(id);
  for (let i = 0; i < 7; i++) {
    const round = await M.Round.findById((await M.Edition.findById(id)).currentRoundId);
    assert.equal(round.figures[0], E.names[i]);
    assert.equal(round.lastSequence, 0);
    await ball(id, 1);
    const money = require('./helpers/prize-fixture.cjs').helpers(actorId);
    await money.settle(id, await money.resolve(id));
    if (i < 6) await G.nextRound(await command(id));
  }
  assert.equal(await M.Round.countDocuments({ editionId: id }), 7);
  assert.equal(await M.FigureResult.countDocuments({ editionId: id, figure: 'O' }), 1);
  const pools = await M.FigureResult.find({ editionId: id });
  assert.equal(
    pools.reduce((sum, result) => sum + result.poolClp, 0),
    400000
  );
  assert.equal(await M.Candidate.countDocuments({ editionId: id, cohort: 'primary' }), 7);
  await assert.rejects(G.nextRound(await command(id)), (e) => e.publicCode === 'game_rounds_complete');
  await G.finish(
    await command(id, {
      reason: 'All configured rounds and prize allocations validated; credits remain pending'
    })
  );
  assert.equal(await M.Award.countDocuments({ editionId: id }), 7);
});

test('contact resolution releases pause only after all primary deadlines are reconciled, including expired timely receipts', async () => {
  const contact = require('../bingo-api/pilot/contacts');
  const id = await fixture(2, gameRules({ pauseDuringContact: true }));
  await start(id);
  await ball(id, 1);
  const candidates = await M.Candidate.find({ editionId: id });
  let now = Date.parse('2026-11-16T21:00:00Z');
  const service = contact.createService(() => new Date(now));
  for (const candidate of candidates) {
    await service.begin(
      await command(id, { candidateId: candidate.id, channel: 'email', evidence: 'Synthetic attempt' })
    );
    await service.notice(
      await command(id, { candidateId: candidate.id, success: true, evidence: 'Notice success' })
    );
    now += 1000;
  }
  now += 60000;
  await assert.rejects(G.resume(await command(id)), (e) => e.publicCode === 'game_pending_contact');
  const first = await M.Candidate.findById(candidates[0]._id);
  await service.respond(
    await command(id, {
      candidateId: first.id,
      receivedAt: first.expiresAt.toISOString(),
      evidence: 'Channel proves timely receipt, recorded after expiration'
    })
  );
  await assert.rejects(G.resume(await command(id)), (e) => e.publicCode === 'game_pending_contact');
  await service.discard(
    await command(id, {
      candidateId: candidates[1].id,
      reviewedNoTimelyResponse: true,
      evidence: 'No timely response in registered channel'
    })
  );
  assert.equal((await G.resume(await command(id))).state, 'playing');
  assert.equal(await M.Award.countDocuments({ editionId: id }), 0);
});
