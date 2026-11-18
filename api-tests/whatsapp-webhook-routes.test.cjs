const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.DB_SECRET = 'synthetic-whatsapp-webhook-secret';
process.env.DELIVERY_WHATSAPP_PROVIDER = 'meta_cloud_api';
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.WHATSAPP_ACCESS_TOKEN = 'token';
process.env.WHATSAPP_TEMPLATE_NAME = 'carton_bingo';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'synthetic-verify-token';
process.env.WHATSAPP_APP_SECRET = 'synthetic-app-secret';
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const { WhatsAppReceipt } = require('../bingo-api/pilot/providers/provider-receipts');
const { createApp } = require('../server');
let replica, server, base;
const oid = () => new mongoose.Types.ObjectId();
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(replica.getUri());
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/bingo-api/webhooks/whatsapp`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.disconnect();
  await replica.stop();
});
function sign(body) {
  return `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(body).digest('hex')}`;
}

test('the verification handshake echoes the challenge only with a matching token', async () => {
  const match = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=abc123`);
  assert.equal(match.status, 200);
  assert.equal(await match.text(), 'abc123');
  const mismatch = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
  assert.equal(mismatch.status, 403);
});

test('a status event with a valid signature updates the matching receipt', async () => {
  const providerKey = `job-${oid()}-1`;
  await WhatsAppReceipt.create({
    providerKey,
    jobId: oid(),
    channel: 'whatsapp',
    state: 'accepted',
    wamid: 'wamid-event-1',
    sentAt: new Date()
  });
  const body = Buffer.from(
    JSON.stringify({
      entry: [
        {
          changes: [
            { value: { statuses: [{ id: 'wamid-event-1', status: 'delivered', timestamp: '1700000000' }] } }
          ]
        }
      ]
    })
  );
  const response = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(body) },
    body
  });
  assert.equal(response.status, 200);
  const receipt = await WhatsAppReceipt.findOne({ wamid: 'wamid-event-1' });
  assert.equal(receipt.state, 'delivered');
  assert.deepEqual(receipt.statusAt, new Date(1700000000 * 1000));
});

test('a missing or invalid signature is rejected without applying the event', async () => {
  const body = Buffer.from(
    JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid-event-1', status: 'failed' }] } }] }] })
  );
  const noSignature = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  assert.equal(noSignature.status, 403);
  const wrongSignature = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) },
    body
  });
  assert.equal(wrongSignature.status, 403);
  const receipt = await WhatsAppReceipt.findOne({ wamid: 'wamid-event-1' });
  assert.equal(receipt.state, 'delivered');
});

test('both routes 404 when WhatsApp is not configured as meta_cloud_api', async () => {
  delete process.env.DELIVERY_WHATSAPP_PROVIDER;
  const app = createApp();
  const standaloneServer = app.listen(0, '127.0.0.1');
  await once(standaloneServer, 'listening');
  const standaloneBase = `http://127.0.0.1:${standaloneServer.address().port}/bingo-api/webhooks/whatsapp`;
  try {
    const get = await fetch(`${standaloneBase}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y`);
    assert.equal(get.status, 404);
    const post = await fetch(standaloneBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(post.status, 404);
  } finally {
    process.env.DELIVERY_WHATSAPP_PROVIDER = 'meta_cloud_api';
    await new Promise((resolve) => standaloneServer.close(resolve));
  }
});
