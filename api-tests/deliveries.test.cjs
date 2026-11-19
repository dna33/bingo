const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run, including the spawned worker CLI below
process.env.DB_SECRET = 'stage4-synthetic-secret';
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const M = require('../bingo-api/pilot/models');
const { provision } = require('../bingo-api/pilot/staff');
const { createEdition } = require('../bingo-api/pilot/persistence');
const I = require('../bingo-api/pilot/imports');
const C = require('../bingo-api/pilot/cards');
const S = require('../bingo-api/pilot/deliveries');
const { createApp } = require('../server');
const oid = () => new mongoose.Types.ObjectId();
let replica, server, base, actorId;
const tokens = {};
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(replica.getUri());
  for (const role of ['administrator', 'importer', 'viewer', 'auditor', 'operator']) {
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
    key: `delivery-${oid()}`,
    expectedVersion: (await M.Edition.findById(editionId)).version,
    input
  };
}
async function fixture(count = 2, close = true) {
  const editionId = oid();
  await createEdition({ editionId, actorId, name: 'Stage 4 synthetic edition' });
  const csv =
    'email,telefono,jugador_id\n' +
    Array.from(
      { length: count },
      (_, i) => `player${i}@example.invalid,+569${String(i).padStart(8, '0')},player-${i}`
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
        confirmationReference: 'Synthetic configuration'
      }
    })
  );
  let remaining = count;
  while (remaining) remaining = (await C.issueBatch(await command(editionId, { limit: 100 }))).remaining;
  if (close) await I.closeList(await command(editionId));
  return { editionId, file, csv };
}
async function enqueue(editionId, simulation = 'accepted', channel = 'email') {
  let remaining = 1;
  while (remaining)
    remaining = (await S.enqueue(await command(editionId, { channel, simulation, limit: 100 }))).remaining;
}
const clock = (start = Date.now() + 1000) => {
  let tick = start;
  return () => new Date((tick += 110));
};
async function event(editionId, job, status, eventKey = `event-${oid()}`) {
  return S.mockEvent(
    await command(editionId, { jobId: job.id, providerKey: job.providerKey, status, eventKey })
  );
}
async function http(editionId, route, role = 'administrator', body) {
  const response = await fetch(`${base}/${editionId}/deliveries${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${tokens[role]}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `http-${oid()}`
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, data: await response.json() };
}
test('queue is persistent, deduplicated across requeue and concurrency, and snapshots one recipient per stored PDF', async () => {
  const { editionId } = await fixture(3);
  const request = await command(editionId, { channel: 'email' });
  const results = await Promise.all([S.enqueue(request), S.enqueue(request)]);
  assert.deepEqual(results[0], results[1]);
  await enqueue(editionId, 'accepted', 'whatsapp');
  assert.equal(await M.Delivery.countDocuments({ editionId }), 3);
  const jobs = await M.Delivery.find({ editionId }).select('+recipient');
  for (const job of jobs) {
    const person = await M.Participant.findById(job.participantId).select('+emails');
    const card = await M.Card.findById(job.cardId);
    assert.ok(person.emails.includes(job.recipient));
    assert.equal(job.channel, 'email');
    assert.equal(job.pdfSha256, card.pdf.sha256);
  }
  const uri = replica.getUri();
  await db.disconnect();
  await db.connect(uri);
  assert.equal(await M.Delivery.countDocuments({ editionId, state: 'pending' }), 3);
});
test('a person with more than one email/phone gets the same card delivered to every known address, never a second card', async () => {
  const editionId = oid();
  await createEdition({ editionId, actorId, name: 'Multi-contact edition' });
  const csv =
    'email,telefono,jugador_id\n' +
    'first@example.invalid,+56900000010,shared\n' +
    'second@example.invalid,+56900000011,shared\n';
  const staged = await I.stageImport(
    await command(editionId, {
      filename: 'synthetic.csv',
      contentBase64: Buffer.from(csv).toString('base64'),
      sourceReference: 'Two contacts, one person'
    })
  );
  await I.applyImport(await command(editionId, { importId: staged.importId }));
  assert.equal(await M.Participant.countDocuments({ editionId }), 1);
  await C.configureCards(
    await command(editionId, {
      settings: { minNumber: 1, maxNumber: 75, columnMode: 'unrestricted', confirmationReference: 'Synthetic' }
    })
  );
  await C.issueBatch(await command(editionId, { limit: 100 }));
  await I.closeList(await command(editionId));
  assert.equal(await M.Card.countDocuments({ editionId }), 1);
  const card = await M.Card.findOne({ editionId });

  await S.enqueue(await command(editionId, { channel: 'email' }));
  assert.equal(await M.Delivery.countDocuments({ editionId }), 2);
  const jobs = await M.Delivery.find({ editionId }).select('+recipient').sort({ recipient: 1 });
  assert.deepEqual(
    jobs.map((j) => j.recipient),
    ['first@example.invalid', 'second@example.invalid']
  );
  for (const job of jobs) {
    assert.equal(String(job.cardId), card.id);
    assert.equal(job.kind, 'initial');
  }
  assert.notEqual(jobs[0].queueKey, jobs[1].queueKey);

  // Re-enqueuing does not add a third job: both known addresses are already queued.
  const again = await S.enqueue(await command(editionId, { channel: 'email' }));
  assert.equal(again.queued, 0);
  assert.equal(await M.Delivery.countDocuments({ editionId }), 2);

  await S.processBatch(editionId, { limit: 10, now: clock() });
  const processed = await M.Delivery.find({ editionId }).select('+providerReference');
  assert.ok(processed.every((j) => j.state === 'provider_accepted'));
  assert.equal(new Set(processed.map((j) => j.providerReference)).size, 2);
});
test('accepted is distinct from delivered; events and retries cannot duplicate a confirmed message', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId);
  await S.processBatch(editionId, { now: clock() });
  let job = await M.Delivery.findOne({ editionId });
  assert.equal(job.state, 'provider_accepted');
  assert.equal(job.deliveredAt, undefined);
  const eventKey = `event-${oid()}`;
  await event(editionId, job, 'delivered', eventKey);
  job = await M.Delivery.findById(job.id);
  assert.equal(job.state, 'delivered');
  assert.ok(job.deliveredAt);
  await event(editionId, job, 'delivered', eventKey);
  assert.equal(await M.DeliveryEvent.countDocuments({ editionId }), 1);
  assert.equal(await M.MockReceipt.countDocuments({ editionId }), 1);
  await assert.rejects(
    S.retry(await command(editionId, { jobId: job.id, reason: 'duplicate test' })),
    (e) => e.publicCode === 'delivery_not_retryable'
  );
  await assert.rejects(event(editionId, job, 'bounced'), (e) => e.publicCode === 'delivery_event_conflict');
});
test('transient failures retry with backoff, permanent failures remain visible, and send failures do not affect participation', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId, 'transient_failure');
  const start = Date.now() + 1000;
  await S.processBatch(editionId, { now: () => new Date(start) });
  let job = await M.Delivery.findOne({ editionId });
  assert.equal(job.state, 'pending');
  assert.equal(job.attemptCount, 1);
  await S.processBatch(editionId, { now: () => new Date(start + 500) });
  assert.equal((await M.Delivery.findById(job.id)).attemptCount, 1);
  await S.processBatch(editionId, { now: () => new Date(start + 1100) });
  job = await M.Delivery.findById(job.id);
  assert.equal(job.state, 'provider_accepted');
  assert.equal(job.attemptCount, 2);
  assert.equal(await M.SendAttempt.countDocuments({ editionId, state: 'failed' }), 1);
  const other = await fixture(1);
  await enqueue(other.editionId, 'permanent_failure');
  await S.processBatch(other.editionId, { now: clock() });
  assert.equal((await M.Delivery.findOne({ editionId: other.editionId })).state, 'failed');
  assert.equal(await M.Participant.countDocuments({ editionId: other.editionId, active: true }), 1);
  assert.equal((await I.reconciliation(await M.Edition.findById(other.editionId))).canClose, true);
});
test('timeout after acceptance reconciles before any resend; timeout before acceptance may safely retry', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId, 'timeout_after_accept');
  await S.processBatch(editionId, { now: clock() });
  let job = await M.Delivery.findOne({ editionId });
  assert.equal(job.state, 'uncertain');
  await assert.rejects(
    S.resend(await command(editionId, { jobId: job.id, channel: 'whatsapp', reason: 'unsafe duplicate' })),
    (e) => e.publicCode === 'delivery_uncertain'
  );
  await S.reconcile(editionId, job.id);
  assert.equal((await M.Delivery.findById(job.id)).state, 'provider_accepted');
  assert.equal(await M.MockReceipt.countDocuments({ editionId }), 1);
  assert.equal(await M.SendAttempt.countDocuments({ editionId }), 1);
  const before = await fixture(1);
  await enqueue(before.editionId, 'timeout_before_accept');
  const t = Date.now() + 1000;
  await S.processBatch(before.editionId, { now: () => new Date(t) });
  job = await M.Delivery.findOne({ editionId: before.editionId });
  await S.reconcile(before.editionId, job.id, new Date(t + 100));
  await S.processBatch(before.editionId, { now: () => new Date(t + 2000) });
  assert.equal((await M.Delivery.findById(job.id)).state, 'provider_accepted');
  assert.equal(
    await M.MockReceipt.countDocuments({ editionId: before.editionId, state: 'provider_accepted' }),
    1
  );
});
test('unresolved provider status blocks blind retry until explicit simulated evidence resolves it', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId, 'unknown');
  await S.processBatch(editionId, { now: clock() });
  let job = await M.Delivery.findOne({ editionId });
  await S.reconcile(editionId, job.id);
  assert.equal((await M.Delivery.findById(job.id)).state, 'uncertain');
  await assert.rejects(
    S.retry(await command(editionId, { jobId: job.id, reason: 'not yet known' })),
    (e) => e.publicCode === 'delivery_uncertain'
  );
  await event(editionId, job, 'not_accepted');
  job = await M.Delivery.findById(job.id);
  assert.equal(job.state, 'pending');
  await S.processBatch(editionId, { now: clock(Date.now() + 10000) });
  assert.equal((await M.Delivery.findById(job.id)).state, 'provider_accepted');
});
test('interruption after provider effect and restart do not duplicate the send, and the persistent rate gate limits concurrent workers', async () => {
  const { editionId } = await fixture(2);
  await enqueue(editionId);
  const t = Date.now() + 1000;
  await assert.rejects(
    S.processBatch(editionId, {
      now: () => new Date(t),
      afterProvider: () => {
        throw Object.assign(new Error('crash'), { simulatedCrash: true });
      }
    }),
    /crash/
  );
  assert.equal(await M.Delivery.countDocuments({ editionId, state: 'processing' }), 1);
  const uri = replica.getUri();
  await db.disconnect();
  await db.connect(uri);
  await S.processBatch(editionId, { now: () => new Date(t + S.LEASE_MS + 1) });
  assert.equal(await M.MockReceipt.countDocuments({ editionId }), 2);
  assert.equal(await M.SendAttempt.countDocuments({ editionId }), 2);
  const another = await fixture(3);
  await enqueue(another.editionId);
  await Promise.all([
    S.processBatch(another.editionId, { now: () => new Date(t) }),
    S.processBatch(another.editionId, { now: () => new Date(t) })
  ]);
  assert.equal(await M.MockReceipt.countDocuments({ editionId: another.editionId }), 1);
});
test('resends and channel fallback use the same card, PDF and person, with separate traceable attempts', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId, 'bounced');
  const original = await M.Card.findOne({ editionId });
  const originalPdf = await M.CardPdf.findOne({ cardId: original._id }).select('+bytes');
  await S.processBatch(editionId, { now: clock() });
  let job = await M.Delivery.findOne({ editionId });
  await S.reconcile(editionId, job.id);
  job = await M.Delivery.findById(job.id);
  assert.equal(job.state, 'bounced');
  const request = await command(editionId, {
    jobId: job.id,
    channel: 'whatsapp',
    simulation: 'delivered',
    reason: 'Email bounced; simulated fallback'
  });
  const fallback = await S.resend(request);
  assert.deepEqual(await S.resend(request), fallback);
  await S.processBatch(editionId, { now: clock(Date.now() + 10000) });
  await S.reconcile(editionId, fallback.jobId);
  const sent = await M.Delivery.findById(fallback.jobId).select('+recipient');
  assert.equal(sent.state, 'delivered');
  assert.equal(String(sent.parentId), job.id);
  assert.equal(String(sent.cardId), original.id);
  const person = await M.Participant.findById(sent.participantId).select('+phones');
  assert.ok(person.phones.includes(sent.recipient));
  assert.equal(await M.Card.countDocuments({ editionId }), 1);
  assert.ok((await M.CardPdf.findById(originalPdf.id).select('+bytes')).bytes.equals(originalPdf.bytes));
  assert.equal(await M.MockReceipt.countDocuments({ editionId }), 2);
});
test('missing/corrupt PDF and changed recipient become incidents without regeneration or silent destination replacement', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId);
  const card = await M.Card.findOne({ editionId });
  await M.CardPdf.collection.updateOne({ cardId: card._id }, { $set: { bytes: Buffer.from('bad') } });
  await S.processBatch(editionId, { now: clock() });
  assert.equal((await M.Delivery.findOne({ editionId })).errorCode, 'pdf_integrity');
  assert.equal(await M.MockReceipt.countDocuments({ editionId }), 0);
  const another = await fixture(1);
  await enqueue(another.editionId);
  await M.Participant.updateOne({ editionId: another.editionId }, { emails: ['corrected@example.invalid'] });
  await S.processBatch(another.editionId, { now: clock() });
  const old = await M.Delivery.findOne({ editionId: another.editionId }).select('+recipient');
  assert.equal(old.errorCode, 'recipient_changed');
  assert.equal(old.recipient, 'player0@example.invalid');
});
test('HTTP permissions isolate contacts, jobs and attempts by edition; manual retry records evidence', async () => {
  const { editionId } = await fixture(1);
  const version = (await M.Edition.findById(editionId)).version;
  assert.equal(
    (await http(editionId, '/enqueue', 'viewer', { expectedVersion: version, channel: 'email' })).status,
    403
  );
  assert.equal(
    (await http(editionId, '/enqueue', 'auditor', { expectedVersion: version, channel: 'email' })).status,
    403
  );
  assert.equal(
    (
      await http(editionId, '/enqueue', 'importer', {
        expectedVersion: version,
        channel: 'email',
        simulation: 'permanent_failure'
      })
    ).status,
    200
  );
  await S.processBatch(editionId, { now: clock() });
  const job = await M.Delivery.findOne({ editionId });
  assert.equal((await http(editionId, '', 'viewer')).status, 403);
  const list = await http(editionId, '', 'auditor');
  assert.equal(list.data[0].recipient, 'player0@example.invalid');
  assert.equal((await http(editionId, '/summary', 'operator')).status, 200);
  const another = await fixture(1);
  assert.equal((await http(another.editionId, `/${job.id}/attempts`, 'auditor')).status, 404);
  const retry = await http(editionId, `/${job.id}/retry`, 'administrator', {
    expectedVersion: (await M.Edition.findById(editionId)).version,
    simulation: 'accepted',
    reason: 'Operator simulated recovery'
  });
  assert.equal(retry.status, 200);
  await S.processBatch(editionId, { now: clock(Date.now() + 10000) });
  const attempts = await http(editionId, `/${job.id}/attempts`, 'auditor');
  assert.equal(attempts.data.length, 2);
  assert.ok(attempts.data[1].providerReference);
  assert.equal(attempts.data[1].recipient, 'player0@example.invalid');
  const stored = await M.Delivery.findById(job.id).select('+retryHistory');
  assert.equal(stored.retryHistory[0].reason, 'Operator simulated recovery');
  const audit = JSON.stringify(await M.Audit.find({ editionId }).lean());
  assert.ok(!audit.includes('player0@example.invalid'));
});
test('the real CLI processes only simulated messages and stops cleanly in once mode', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId);
  const child = spawn(process.execPath, ['scripts/delivery-worker.cjs', '--once'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_URI: replica.getUri() },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.match(output, /"email":\{"provider":"mock","sandbox":true\}/);
  assert.match(output, /"whatsapp":\{"provider":"mock","sandbox":true\}/);
  assert.ok(!output.includes('player0@example.invalid'));
  assert.equal(await M.MockReceipt.countDocuments({ editionId }), 1);
});
test(
  '3000 queued deliveries preserve every recipient/PDF and replaying queue creation makes no extra jobs',
  { timeout: 180000 },
  async () => {
    const { editionId } = await fixture(3000);
    await enqueue(editionId);
    assert.equal(await M.Delivery.countDocuments({ editionId }), 3000);
    await enqueue(editionId, 'accepted', 'whatsapp');
    assert.equal(await M.Delivery.countDocuments({ editionId }), 3000);
    const now = clock();
    for (let i = 0; i < 30; i++) await S.processBatch(editionId, { limit: 100, now });
    const receipts = await M.MockReceipt.find({ editionId }).select('+recipient');
    assert.equal(receipts.length, 3000);
    const cards = new Map((await M.Card.find({ editionId })).map((card) => [card.id, card.pdf.sha256]));
    const jobs = new Map(
      (await M.Delivery.find({ editionId }).select('+recipient')).map((job) => [job.id, job])
    );
    for (const receipt of receipts) {
      const job = jobs.get(String(receipt.jobId));
      assert.equal(receipt.recipient, job.recipient);
      assert.equal(receipt.attachmentSha256, cards.get(String(job.cardId)));
      assert.equal(receipt.contentType, 'application/pdf');
      assert.ok(receipt.attachmentSize > 1000);
    }
    assert.equal(await M.SendAttempt.countDocuments({ editionId }), 3000);
  }
);

test('automatic retries stop at three attempts and require an explicit operator action afterwards', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId, 'temporary_outage');
  const t = Date.now() + 1000;
  for (const offset of [0, 1100, 3200, 10000])
    await S.processBatch(editionId, { now: () => new Date(t + offset) });
  const job = await M.Delivery.findOne({ editionId });
  assert.equal(job.attemptCount, 3);
  assert.equal(job.state, 'failed');
  assert.equal(await M.SendAttempt.countDocuments({ editionId }), 3);
  await S.retry(
    await command(editionId, {
      jobId: job.id,
      reason: 'Explicit recovery after retry budget',
      simulation: 'accepted'
    })
  );
  await S.processBatch(editionId, { now: () => new Date(t + 20000) });
  assert.equal((await M.Delivery.findById(job.id)).state, 'provider_accepted');
});
test('a definitive negative provider receipt seals an old key against a late worker', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId, 'timeout_before_accept');
  await S.processBatch(editionId, { now: clock() });
  const job = await M.Delivery.findOne({ editionId }).select('+recipient');
  await S.reconcile(editionId, job.id);
  const card = await M.Card.findById(job.cardId),
    pdf = await M.CardPdf.findOne({ cardId: card._id }).select('+bytes');
  await assert.rejects(
    require('../bingo-api/pilot/mock-provider').send(
      {
        to: job.recipient,
        channel: job.channel,
        idempotencyKey: job.providerKey,
        attachment: {
          bytes: Buffer.from(pdf.bytes),
          sha256: pdf.sha256,
          contentType: 'application/pdf',
          filename: `carton-${card.cardCode}.pdf`
        }
      },
      job
    ),
    (e) => e.providerCode === 'provider_not_accepted'
  );
  assert.equal(await M.MockReceipt.countDocuments({ editionId, state: 'provider_accepted' }), 0);
  await assert.rejects(event(editionId, job, 'delivered'), (e) => e.publicCode === 'delivery_event_conflict');
});

test('a stale worker response cannot regress delivery after lease recovery and confirmed delivery', async () => {
  const { editionId } = await fixture(1);
  await enqueue(editionId);
  const t = Date.now() + 1000;
  let ready, release;
  const reached = new Promise((resolve) => {
    ready = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const oldWorker = S.processBatch(editionId, {
    now: () => new Date(t),
    afterProvider: async () => {
      ready();
      await blocked;
    }
  });
  await reached;
  let job = await M.Delivery.findOne({ editionId });
  await S.reconcile(editionId, job.id, new Date(t + S.LEASE_MS + 1));
  job = await M.Delivery.findById(job.id);
  assert.equal(job.state, 'provider_accepted');
  await event(editionId, job, 'delivered');
  release();
  await oldWorker;
  assert.equal((await M.Delivery.findById(job.id)).state, 'delivered');
  assert.equal(await M.MockReceipt.countDocuments({ editionId, state: 'delivered' }), 1);
});
