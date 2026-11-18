const express = require('express');
const crypto = require('node:crypto');
const asyncHandler = require('../utils/async-handler');
const { providerConfig } = require('../config/provider');
const { WhatsAppReceipt } = require('./providers/provider-receipts');
const router = express.Router();

// Meta cannot present a Fabuloso staff JWT; its only credential is this HMAC signature, so this
// router sits outside the authenticated /bingo-api/pilot tree and must see the raw request body.
function whatsappConfig(env = process.env) {
  const config = providerConfig(env).whatsapp;
  return config.provider === 'meta_cloud_api' ? config.metaCloudApi : null;
}

function validSignature(config, rawBody, header) {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', config.appSecret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(header),
    b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const statusMap = { sent: 'accepted', delivered: 'delivered', read: 'read', failed: 'failed' };

async function applyStatus(status) {
  const state = statusMap[status.status];
  if (!state || typeof status.id !== 'string') return;
  const statusAt = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();
  await WhatsAppReceipt.updateOne({ wamid: status.id }, { $set: { state, statusAt } });
}

router.get('/webhooks/whatsapp', (req, res) => {
  const config = whatsappConfig();
  if (!config) return res.status(404).end();
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.webhookVerifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

router.post(
  '/webhooks/whatsapp',
  express.raw({ type: 'application/json', limit: '2mb' }),
  asyncHandler(async (req, res) => {
    const config = whatsappConfig();
    if (!config) return res.status(404).end();
    if (!Buffer.isBuffer(req.body) || !validSignature(config, req.body, req.get('X-Hub-Signature-256'))) {
      return res.sendStatus(403);
    }
    const payload = JSON.parse(req.body.toString('utf8'));
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        for (const status of (change.value && change.value.statuses) || []) await applyStatus(status);
      }
    }
    return res.sendStatus(200);
  })
);

module.exports = router;
