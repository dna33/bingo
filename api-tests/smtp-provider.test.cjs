const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.DB_SECRET = 'synthetic-smtp-provider-secret';
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const { sha256 } = require('../bingo-api/pilot/cards');
const createSmtpProvider = require('../bingo-api/pilot/providers/smtp-provider');
let replica;
const oid = () => new mongoose.Types.ObjectId();
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(replica.getUri());
});
after(async () => {
  await db.disconnect();
  await replica.stop();
});
function attachment(bytes = Buffer.from('%PDF-1.4 synthetic')) {
  return { bytes, sha256: sha256(bytes), contentType: 'application/pdf', filename: 'carton-ABC123.pdf' };
}
function message(overrides = {}) {
  return {
    idempotencyKey: `job-${oid()}-1`,
    to: 'jugador@example.invalid',
    channel: 'email',
    attachment: attachment(),
    ...overrides
  };
}

test('sandbox mode never opens a real socket and records a durable receipt', async () => {
  const provider = createSmtpProvider({ sandbox: true, from: 'bingo@example.invalid' });
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  const result = await provider.send({ ...message(), idempotencyKey: job.providerKey }, job);
  assert.ok(result.reference);
  const lookup = await provider.lookup(job);
  assert.deepEqual(
    { found: lookup.found, definitive: lookup.definitive, state: lookup.state, reference: lookup.reference },
    { found: true, definitive: true, state: 'provider_accepted', reference: result.reference }
  );
});

test('lookup is unresolved before any send and stays provider_accepted only, never delivered/bounced', async () => {
  const provider = createSmtpProvider({ sandbox: true, from: 'bingo@example.invalid' });
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  assert.deepEqual(await provider.lookup(job), { found: false, definitive: false });
  await provider.send({ ...message(), idempotencyKey: job.providerKey }, job);
  const resolved = await provider.lookup(job);
  assert.equal(resolved.state, 'provider_accepted');
});

test('a repeated idempotency key short-circuits without sending twice', async () => {
  let calls = 0;
  const provider = createSmtpProvider(
    { sandbox: false, host: 'smtp.example.invalid', port: 587, secure: false, user: 'u', pass: 'p', from: 'bingo@example.invalid' },
    {
      createTransport: () => ({
        sendMail: async () => {
          calls++;
          return { messageId: 'real-message-id' };
        }
      })
    }
  );
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  const first = await provider.send({ ...message(), idempotencyKey: job.providerKey }, job);
  const second = await provider.send({ ...message(), idempotencyKey: job.providerKey }, job);
  assert.equal(calls, 1);
  assert.equal(first.reference, second.reference);
});

test('cc, bcc and a malformed recipient are rejected before any transport call', async () => {
  const provider = createSmtpProvider({ sandbox: true, from: 'bingo@example.invalid' });
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  await assert.rejects(provider.send(message({ to: '' }), job), /invalid_message/);
  await assert.rejects(provider.send(message({ cc: 'other@example.invalid' }), job), /invalid_message/);
  await assert.rejects(provider.send(message({ bcc: 'other@example.invalid' }), job), /invalid_message/);
});

test('an attachment that is not a matching PDF buffer is rejected', async () => {
  const provider = createSmtpProvider({ sandbox: true, from: 'bingo@example.invalid' });
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  await assert.rejects(
    provider.send(message({ attachment: { ...attachment(), contentType: 'text/plain' } }), job),
    /invalid_attachment/
  );
  await assert.rejects(
    provider.send(message({ attachment: { ...attachment(), sha256: 'mismatch' } }), job),
    /invalid_attachment/
  );
});

test('transport errors are mapped to explicit providerCode/uncertain/retryable, never left to auto-uncertain', async () => {
  const scenario = async (responseCode) => {
    const provider = createSmtpProvider(
      { sandbox: false, host: 'h', port: 587, secure: false, user: 'u', pass: 'p', from: 'bingo@example.invalid' },
      {
        createTransport: () => ({
          sendMail: async () => {
            throw Object.assign(new Error('smtp failure'), responseCode ? { responseCode } : {});
          }
        })
      }
    );
    const job = { _id: oid(), providerKey: `job-${oid()}-1` };
    try {
      await provider.send(message({ idempotencyKey: job.providerKey }), job);
      assert.fail('expected send to throw');
    } catch (error) {
      return { providerCode: error.providerCode, uncertain: error.uncertain, retryable: error.retryable };
    }
  };
  assert.deepEqual(await scenario(undefined), { providerCode: 'smtp_timeout', uncertain: true, retryable: false });
  assert.deepEqual(await scenario(450), { providerCode: 'smtp_temporary_reject', uncertain: false, retryable: true });
  assert.deepEqual(await scenario(550), { providerCode: 'smtp_rejected', uncertain: false, retryable: false });
});
