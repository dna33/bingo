const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'stage6-synthetic-secret';
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const M = require('../bingo-api/pilot/models');
const { provision } = require('../bingo-api/pilot/staff');
const { createEdition, recordEvaluatedDraw } = require('../bingo-api/pilot/persistence');
const C = require('../bingo-api/pilot/contacts');
const { createApp } = require('../server');
const oid = () => new mongoose.Types.ObjectId();
let replica, server, base, actorId;
const tokens = {};
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
    key: `contact-${oid()}`,
    expectedVersion: (await M.Edition.findById(editionId)).version,
    input
  };
}
async function fixture(count = 2) {
  const editionId = oid(),
    configId = oid();
  await createEdition({ editionId, actorId, name: 'Synthetic contact test' });
  const round = await M.Round.create({
    editionId,
    ordinal: 0,
    rulesVersion: 1,
    minNumber: 1,
    maxNumber: 75,
    state: 'playing',
    figures: ['F'],
    gameConfigurationId: configId
  });
  await M.Edition.updateOne({ _id: editionId }, { state: 'playing', currentRoundId: round._id });
  const cards = [];
  for (let i = 0; i < count; i++) {
    const sourceRowId = oid();
    const person = await M.Participant.create({
      editionId,
      sourceRowId,
      participantKey: `p${i}`,
      email: `p${i}@example.invalid`,
      phone: `+5690000000${i}`,
      name: `Person ${i}`
    });
    cards.push(
      await M.Card.create({
        editionId,
        sourceRowId,
        participantId: person._id,
        cardCode: `synthetic-${oid()}`,
        cells: Array.from({ length: 25 }, (_, j) => (j === 12 ? null : j + 1 + i * 25))
      })
    );
  }
  const drawCommand = await command(editionId, { roundId: round.id, number: 1, origin: 'manual' });
  const evaluator = async () =>
    cards.map((card) => ({
      cardId: card._id,
      figure: 'F',
      maskVersion: 1,
      evidence: {
        number: 1,
        sequence: 1,
        mask: ['10000', '00000', '00100', '00000', '00000'],
        cells: card.cells
      }
    }));
  await recordEvaluatedDraw(drawCommand, evaluator);
  await M.FigureResult.create({
    editionId,
    roundId: round._id,
    gameConfigurationId: configId,
    figure: 'F',
    poolClp: 50000,
    state: 'detected',
    primaryCandidateCount: count
  });
  const candidates = await M.Candidate.find({ editionId }).sort({ _id: 1 });
  return { editionId, candidates, cards, round, drawCommand, evaluator };
}
function timeline() {
  let time = Date.parse('2026-11-16T20:00:00Z');
  return {
    service: C.createService(() => new Date(time)),
    set: (ms) => {
      time = ms;
    },
    tick: (ms) => {
      time += ms;
    },
    now: () => time
  };
}
async function waiting(f, t, candidate = f.candidates[0]) {
  await t.service.begin(
    await command(f.editionId, {
      candidateId: candidate.id,
      channel: 'email',
      evidence: 'External contact attempt, synthetic'
    })
  );
  return t.service.notice(
    await command(f.editionId, {
      candidateId: candidate.id,
      success: true,
      evidence: 'Successful notice recorded, synthetic'
    })
  );
}
async function http(f, tail, role = 'operator', body) {
  const response = await fetch(`${base}/${f.editionId}/game/${tail}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${tokens[role]}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `http-${oid()}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() };
}
test('draw and all ties create one persistent alert atomically; replay, acknowledgement and recovery never duplicate it', async () => {
  const f = await fixture(3);
  await recordEvaluatedDraw(f.drawCommand, f.evaluator);
  assert.equal(await M.Candidate.countDocuments({ editionId: f.editionId }), 3);
  const alert = await M.CandidateAlert.findOne({ editionId: f.editionId });
  assert.equal(alert.candidateCount, 3);
  const ack = await command(f.editionId, { alertId: alert.id });
  assert.deepEqual(await C.acknowledge(ack), await C.acknowledge(ack));
  const acknowledged = await M.CandidateAlert.findById(alert._id);
  await C.reconcileAlerts(await command(f.editionId));
  assert.equal(await M.CandidateAlert.countDocuments({ editionId: f.editionId }), 1);
  assert.equal(
    (await M.CandidateAlert.findById(alert._id)).acknowledgedAt.getTime(),
    acknowledged.acknowledgedAt.getTime()
  );
  assert.equal((await M.Candidate.findById(f.candidates[0]._id)).state, 'detected');
  await M.CandidateAlert.deleteOne({ _id: alert._id }); // Simulate upgrade from stage 5.
  await C.reconcileAlerts(await command(f.editionId));
  assert.equal((await M.CandidateAlert.findOne({ editionId: f.editionId })).candidateCount, 3);
});
test('failed notice never starts the minute; recipient is resolved by server and successful notice is idempotent', async () => {
  const f = await fixture(),
    t = timeline(),
    id = f.candidates[0].id;
  await t.service.begin(
    await command(f.editionId, { candidateId: id, channel: 'email', evidence: 'Attempt evidence' })
  );
  await t.service.notice(
    await command(f.editionId, { candidateId: id, success: false, evidence: 'Could not notify' })
  );
  let row = await M.Candidate.findById(id).select('+recipient');
  assert.equal(row.state, 'contacting');
  assert.equal(row.expiresAt, undefined);
  assert.match(row.recipient, /^p\d@example.invalid$/);
  const cmd = await command(f.editionId, { candidateId: id, success: true, evidence: 'Notice successful' });
  const first = await t.service.notice(cmd);
  t.tick(15000);
  assert.deepEqual(await t.service.notice(cmd), first);
  row = await M.Candidate.findById(id);
  assert.equal(row.expiresAt - row.contactStartedAt, 60000);
  await assert.rejects(
    t.service.notice(
      await command(f.editionId, { candidateId: id, success: true, evidence: 'Another notice' })
    ),
    /blocked/
  );
  const failure = await M.ContactEvent.findOne({ candidateId: id, action: 'notice_failed' });
  assert.ok(failure);
});
test('tied candidates keep independent 60-second deadlines and survive a fresh service/reconnect', async () => {
  const f = await fixture(),
    t = timeline();
  const first = await waiting(f, t);
  t.tick(45000);
  const second = await waiting(f, t, f.candidates[1]);
  assert.equal(new Date(second.expiresAt) - new Date(first.expiresAt), 45000);
  t.tick(15001);
  const rows = await M.Candidate.find({ editionId: f.editionId }).lean();
  assert.equal(
    C.publicStatus(
      rows.find((c) => String(c._id) === f.candidates[0].id),
      new Date(t.now())
    ).deadlineStatus,
    'expired_pending_review'
  );
  assert.equal(
    C.publicStatus(
      rows.find((c) => String(c._id) === f.candidates[1].id),
      new Date(t.now())
    ).deadlineStatus,
    'running'
  );
  const restored = C.createService(() => new Date(t.now()));
  await assert.rejects(
    restored.begin(
      await command(f.editionId, {
        candidateId: f.candidates[0].id,
        channel: 'whatsapp',
        evidence: 'Do not reset'
      })
    ),
    /blocked/
  );
  assert.equal(
    (await M.Candidate.findById(f.candidates[0]._id)).expiresAt.getTime(),
    new Date(first.expiresAt).getTime()
  );
});
test('response exactly at expiration is timely, late recording with evidence is audited, genuinely late response is discarded', async () => {
  const f = await fixture(),
    t = timeline();
  const first = await waiting(f, t),
    second = await waiting(f, t, f.candidates[1]);
  t.tick(90000);
  const response = await command(f.editionId, {
    candidateId: f.candidates[0].id,
    receivedAt: new Date(first.expiresAt).toISOString(),
    evidence: 'Channel timestamp proves boundary receipt'
  });
  assert.equal((await t.service.respond(response)).state, 'confirmed');
  assert.equal((await t.service.respond(response)).state, 'confirmed');
  const late = await t.service.respond(
    await command(f.editionId, {
      candidateId: f.candidates[1].id,
      receivedAt: new Date(new Date(second.expiresAt).getTime() + 1).toISOString(),
      evidence: 'Actually one millisecond late'
    })
  );
  assert.equal(late.state, 'discarded');
  assert.equal(late.resolution, 'late_response');
  assert.equal(await M.Award.countDocuments({ editionId: f.editionId }), 0);
  assert.equal(
    await M.ContactEvent.countDocuments({ candidateId: f.candidates[0]._id, action: 'response_recorded' }),
    1
  );
  const audits = await M.Audit.find({ editionId: f.editionId }).lean();
  assert.ok(audits.some((a) => a.action === 'candidate.response_recorded'));
  assert.ok(!JSON.stringify(audits).includes('Channel timestamp'));
});
test('discard needs expired deadline and explicit channel review; terminal confirmation and discard are mutually exclusive', async () => {
  const f = await fixture(),
    t = timeline(),
    id = f.candidates[0].id;
  const started = await waiting(f, t);
  const body = {
    candidateId: id,
    evidence: 'No timely response after checking channel',
    reviewedNoTimelyResponse: true
  };
  t.tick(60000);
  await assert.rejects(t.service.discard(await command(f.editionId, body)), /blocked/);
  t.tick(1);
  await assert.rejects(
    t.service.discard(await command(f.editionId, { ...body, reviewedNoTimelyResponse: false })),
    /blocked/
  );
  const cmd = await command(f.editionId, body);
  assert.equal((await t.service.discard(cmd)).state, 'discarded');
  assert.equal((await t.service.discard(cmd)).state, 'discarded');
  await assert.rejects(
    t.service.respond(
      await command(f.editionId, {
        candidateId: id,
        receivedAt: new Date(started.expiresAt).toISOString(),
        evidence: 'Cannot overwrite terminal review'
      })
    ),
    /blocked/
  );
});
test('concurrent opposite resolutions serialize and only one event commits', async () => {
  const f = await fixture(),
    t = timeline(),
    id = f.candidates[0].id;
  const notice = await waiting(f, t);
  t.tick(60001);
  const v = (await M.Edition.findById(f.editionId)).version;
  const results = await Promise.allSettled([
    t.service.respond({
      ...(await command(f.editionId, {
        candidateId: id,
        receivedAt: new Date(notice.expiresAt).toISOString(),
        evidence: 'Timely receipt'
      })),
      expectedVersion: v
    }),
    t.service.discard({
      ...(await command(f.editionId, {
        candidateId: id,
        reviewedNoTimelyResponse: true,
        evidence: 'Channel reviewed no response'
      })),
      expectedVersion: v
    })
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    await M.ContactEvent.countDocuments({
      candidateId: id,
      action: { $in: ['response_recorded', 'no_response_resolved'] }
    }),
    1
  );
});
test('rejects future or pre-notice response, absent evidence, reserve and already adjudicated result', async () => {
  const f = await fixture(),
    t = timeline(),
    id = f.candidates[0].id;
  const notice = await waiting(f, t);
  for (const receivedAt of [
    new Date(t.now() + 1).toISOString(),
    new Date(t.now() - 1).toISOString(),
    '2026-11-16T20:00:00'
  ])
    await assert.rejects(
      t.service.respond(await command(f.editionId, { candidateId: id, receivedAt, evidence: 'Timestamp' }))
    );
  await assert.rejects(
    t.service.respond(
      await command(f.editionId, {
        candidateId: id,
        receivedAt: new Date(notice.contactStartedAt).toISOString(),
        evidence: ''
      })
    )
  );
  await M.Candidate.updateOne({ _id: f.candidates[1]._id }, { cohort: 'reserve' });
  await assert.rejects(
    t.service.begin(
      await command(f.editionId, {
        candidateId: f.candidates[1].id,
        channel: 'email',
        evidence: 'Cannot contact reserve yet'
      })
    ),
    /blocked/
  );
  await M.FigureResult.updateOne({ editionId: f.editionId }, { state: 'adjudicated' });
  await assert.rejects(
    t.service.respond(
      await command(f.editionId, {
        candidateId: id,
        receivedAt: new Date(notice.contactStartedAt).toISOString(),
        evidence: 'Cannot alter pool'
      })
    ),
    /blocked/
  );
});
test('HTTP permissions, privacy and edition scoping; PDF delivery trace links to same card and person', async () => {
  const f = await fixture(),
    other = await fixture(1),
    id = f.candidates[0].id;
  const v = (await M.Edition.findById(f.editionId)).version;
  const input = {
    expectedVersion: v,
    channel: 'email',
    recipient: 'attacker@example.invalid',
    evidence: 'External notice'
  };
  assert.equal((await http(f, `candidates/${id}/begin`, 'viewer', input)).status, 403);
  assert.equal((await http(f, `candidates/${id}/begin`, 'importer', input)).status, 403);
  assert.equal(
    (await http(other, `candidates/${id}/begin`, 'operator', { ...input, expectedVersion: 1 })).status,
    404
  );
  assert.equal((await http(f, `candidates/${id}/begin`, 'operator', input)).status, 200);
  const notices = await http(f, `candidates/${id}/notice`, 'operator', {
    expectedVersion: v + 1,
    success: true,
    evidence: 'Notice actually successful',
    expiresAt: '2099-01-01T00:00:00Z'
  });
  assert.equal(notices.status, 200);
  assert.equal(Date.parse(notices.body.expiresAt) - Date.parse(notices.body.contactStartedAt), 60000);
  const listed = await http(f, 'candidates', 'viewer');
  const alerts = await http(f, 'alerts', 'viewer');
  assert.equal(listed.status, 200);
  assert.equal(alerts.body.pendingCount, 1);
  assert.equal((await http(f, `candidates/${id}/contact`, 'viewer')).status, 403);
  const owner = f.candidates[0];
  const delivery = await M.Delivery.create({
    editionId: f.editionId,
    participantId: owner.participantId,
    cardId: owner.cardId,
    sourceRowId: oid(),
    queueKey: `initial-${oid()}`,
    kind: 'initial',
    channel: 'email',
    recipient: 'original-recipient@example.invalid',
    pdfSha256: 'synthetic-sha',
    createdBy: actorId,
    simulation: 'accepted',
    nextAttemptAt: new Date()
  });
  await M.Delivery.create({
    editionId: f.editionId,
    participantId: f.candidates[1].participantId,
    cardId: f.candidates[1].cardId,
    sourceRowId: oid(),
    queueKey: `initial-${oid()}`,
    kind: 'initial',
    channel: 'email',
    recipient: 'other-person@example.invalid',
    pdfSha256: 'synthetic-other',
    createdBy: actorId,
    simulation: 'accepted',
    nextAttemptAt: new Date()
  });
  const privateView = await http(f, `candidates/${id}/contact`, 'operator');
  assert.ok(privateView.body.workflow.recipient.endsWith('@example.invalid'));
  assert.notEqual(privateView.body.workflow.recipient, input.recipient);
  assert.equal(privateView.body.events.length, 2);
  assert.equal(privateView.body.deliveries.length, 1);
  assert.equal(privateView.body.deliveries[0]._id, delivery.id);
  assert.equal(privateView.body.deliveries[0].recipient, 'original-recipient@example.invalid');
  assert.ok(!JSON.stringify(listed.body).includes('@example.invalid'));
  assert.ok(!JSON.stringify(alerts.body).includes('@example.invalid'));
  const alert = await M.CandidateAlert.findOne({ editionId: f.editionId });
  assert.equal(
    (await http(other, `alerts/${alert.id}/acknowledge`, 'operator', { expectedVersion: 1 })).status,
    404
  );
  assert.equal((await http(f, 'alerts?limit=101', 'viewer')).status, 400);
  await assert.rejects(
    M.ContactEvent.updateMany({ candidateId: id }, { evidence: 'Overwrite' }),
    /append-only/
  );
});

test('alert grouping separates figures and reserves, and a failed draw rolls back candidates and alerts', async () => {
  const f = await fixture();
  const c = f.cards[0];
  const more = await command(f.editionId, { roundId: f.round.id, number: 2, origin: 'manual' });
  await recordEvaluatedDraw(more, async () => [
    { cardId: c._id, figure: 'A', maskVersion: 1, evidence: { sequence: 2 } },
    { cardId: c._id, figure: 'B', maskVersion: 1, evidence: { sequence: 2 }, cohort: 'reserve' }
  ]);
  assert.equal(await M.CandidateAlert.countDocuments({ editionId: f.editionId }), 3);
  assert.equal(await M.CandidateAlert.countDocuments({ editionId: f.editionId, cohort: 'reserve' }), 1);
  await assert.rejects(
    recordEvaluatedDraw(
      await command(f.editionId, { roundId: f.round.id, number: 3, origin: 'manual' }),
      async () => [
        { cardId: c._id, figure: 'F', maskVersion: 1, evidence: {} } // Duplicate candidate, fails after draw write.
      ]
    )
  );
  assert.equal(await M.Draw.countDocuments({ roundId: f.round._id }), 2);
  assert.equal(await M.CandidateAlert.countDocuments({ editionId: f.editionId }), 3);
});
test('HTTP server restart retains original deadline and pending alert for reconnecting console', async () => {
  const f = await fixture(),
    id = f.candidates[0].id;
  let version = (await M.Edition.findById(f.editionId)).version;
  assert.equal(
    (
      await http(f, `candidates/${id}/begin`, 'operator', {
        expectedVersion: version++,
        channel: 'whatsapp',
        evidence: 'Synthetic operator notice'
      })
    ).status,
    200
  );
  const notified = await http(f, `candidates/${id}/notice`, 'operator', {
    expectedVersion: version,
    success: true,
    evidence: 'Successful synthetic notice'
  });
  await new Promise((resolve) => server.close(resolve));
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/bingo-api/pilot/editions`;
  const view = await http(f, `candidates/${id}/contact`);
  assert.equal(view.body.workflow.expiresAt, notified.body.expiresAt);
  assert.equal(view.body.workflow.contactStartedAt, notified.body.contactStartedAt);
  assert.equal((await http(f, 'alerts')).body.pendingCount, 1);
});

test('alert rows, pending count and edition version share a snapshot across a concurrent recognition', async () => {
  const f = await fixture(3),
    before = (await M.Edition.findById(f.editionId)).version;
  const alert = await M.CandidateAlert.findOne({ editionId: f.editionId });
  const observations = await Promise.all([
    ...Array.from({ length: 8 }, () => http(f, 'alerts?pending=true&limit=100', 'viewer')),
    C.acknowledge(await command(f.editionId, { alertId: alert.id }))
  ]);
  for (const response of observations.slice(0, 8)) {
    assert.equal(response.status, 200);
    const value = response.body;
    assert.ok([before, before + 1].includes(value.version));
    assert.equal(value.pendingCount, value.version === before ? 1 : 0);
    assert.equal(value.rows.length, value.pendingCount);
    if (value.rows.length) assert.equal(value.rows[0].acknowledgedAt, undefined);
  }
  assert.equal((await http(f, 'alerts', 'viewer')).body.version, before + 1);
});
