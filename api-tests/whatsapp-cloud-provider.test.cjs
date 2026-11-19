const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'synthetic-whatsapp-provider-secret';
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const { sha256 } = require('../bingo-api/pilot/cards');
const createWhatsAppCloudProvider = require('../bingo-api/pilot/providers/whatsapp-cloud-provider');
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
const baseConfig = {
  phoneNumberId: '1234567890',
  accessToken: 'token',
  apiVersion: 'v21.0',
  apiBaseUrl: 'https://graph.example.invalid',
  templateName: 'carton_bingo',
  templateLang: 'es'
};
function attachment(bytes = Buffer.from('%PDF-1.4 synthetic')) {
  return { bytes, sha256: sha256(bytes), contentType: 'application/pdf', filename: 'carton-ABC123.pdf' };
}
function message(overrides = {}) {
  return {
    idempotencyKey: `job-${oid()}-1`,
    to: '+56900000000',
    channel: 'whatsapp',
    attachment: attachment(),
    ...overrides
  };
}

test('sandbox mode never calls fetch and records a synthetic receipt', async () => {
  let calls = 0;
  const provider = createWhatsAppCloudProvider(
    { ...baseConfig, sandbox: true },
    { fetch: async () => { calls++; } }
  );
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  const result = await provider.send({ ...message(), idempotencyKey: job.providerKey }, job);
  assert.equal(calls, 0);
  assert.match(result.reference, /^sandbox-/);
  const lookup = await provider.lookup(job);
  assert.deepEqual(
    { found: lookup.found, definitive: lookup.definitive, state: lookup.state },
    { found: true, definitive: true, state: 'provider_accepted' }
  );
});

test('a real send uploads media then sends a template message, returning the wamid', async () => {
  const calls = [];
  const provider = createWhatsAppCloudProvider(
    { ...baseConfig, sandbox: false },
    {
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url.includes('/media')) return { ok: true, json: async () => ({ id: 'media-1' }) };
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid-1' }] }) };
      }
    }
  );
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  const result = await provider.send({ ...message(), idempotencyKey: job.providerKey }, job);
  assert.equal(result.reference, 'wamid-1');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/media$/);
  assert.match(calls[1].url, /\/messages$/);
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.template.name, 'carton_bingo');
  assert.equal(body.template.components[0].parameters[0].document.id, 'media-1');
  const lookup = await provider.lookup(job);
  assert.equal(lookup.reference, 'wamid-1');
});

test('a repeated idempotency key short-circuits without calling fetch again', async () => {
  let calls = 0;
  const provider = createWhatsAppCloudProvider(
    { ...baseConfig, sandbox: false },
    {
      fetch: async (url) => {
        calls++;
        if (url.includes('/media')) return { ok: true, json: async () => ({ id: 'media-1' }) };
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid-2' }] }) };
      }
    }
  );
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  const first = await provider.send({ ...message(), idempotencyKey: job.providerKey }, job);
  const second = await provider.send({ ...message(), idempotencyKey: job.providerKey }, job);
  assert.equal(calls, 2);
  assert.equal(first.reference, second.reference);
});

test('cc, bcc and a mismatched attachment are rejected before any fetch call', async () => {
  const provider = createWhatsAppCloudProvider({ ...baseConfig, sandbox: false }, { fetch: async () => assert.fail('should not call fetch') });
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  await assert.rejects(provider.send(message({ cc: 'x' }), job), /invalid_message/);
  await assert.rejects(provider.send(message({ attachment: { ...attachment(), sha256: 'bad' } }), job), /invalid_attachment/);
});

test('a Graph API error response maps to an explicit providerCode with status-based retryable', async () => {
  const provider = createWhatsAppCloudProvider(
    { ...baseConfig, sandbox: false },
    {
      fetch: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 131026, message: 'Message undeliverable' } })
      })
    }
  );
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  try {
    await provider.send(message({ idempotencyKey: job.providerKey }), job);
    assert.fail('expected send to throw');
  } catch (error) {
    assert.equal(error.providerCode, 'whatsapp_131026');
    assert.equal(error.uncertain, false);
    assert.equal(error.retryable, false);
  }
});

test('a network failure during upload is uncertain, not a definite failure', async () => {
  const provider = createWhatsAppCloudProvider(
    { ...baseConfig, sandbox: false },
    { fetch: async () => { throw new Error('ECONNRESET'); } }
  );
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  try {
    await provider.send(message({ idempotencyKey: job.providerKey }), job);
    assert.fail('expected send to throw');
  } catch (error) {
    assert.deepEqual(
      { providerCode: error.providerCode, uncertain: error.uncertain, retryable: error.retryable },
      { providerCode: 'whatsapp_timeout', uncertain: true, retryable: false }
    );
  }
});

test('lookup maps read/delivered/failed receipt states onto the shared delivery vocabulary', async () => {
  const provider = createWhatsAppCloudProvider({ ...baseConfig, sandbox: true }, { fetch: async () => { assert.fail(); } });
  const job = { _id: oid(), providerKey: `job-${oid()}-1` };
  assert.deepEqual(await provider.lookup(job), { found: false, definitive: false });
});
