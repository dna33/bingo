// This adapter has no network, email, SMTP or WhatsApp client. Receipts represent
// simulated provider effects and survive a worker restart in MongoDB.
const { MockReceipt, Delivery, Card } = require('./models');
const { fingerprint } = require('./commands');
const { sha256 } = require('./cards');
const scenarios = [
  'accepted',
  'delivered',
  'bounced',
  'transient_failure',
  'temporary_outage',
  'permanent_failure',
  'timeout_before_accept',
  'timeout_after_accept',
  'unknown'
];
function error(code, uncertain = false, retryable = false) {
  return Object.assign(new Error(code), { providerCode: code, uncertain, retryable });
}
async function send(message, job) {
  if (
    typeof message.to !== 'string' ||
    !message.to ||
    message.cc ||
    message.bcc ||
    !Buffer.isBuffer(message.attachment.bytes) ||
    sha256(message.attachment.bytes) !== message.attachment.sha256 ||
    message.attachment.contentType !== 'application/pdf'
  )
    throw error('invalid_message');
  const digest = fingerprint({
    to: message.to,
    channel: message.channel,
    sha256: message.attachment.sha256,
    filename: message.attachment.filename
  });
  let receipt = await MockReceipt.findOne({ providerKey: message.idempotencyKey });
  if (receipt) {
    if (receipt.payloadHash !== digest) throw error('provider_key_conflict');
    if (receipt.state === 'not_accepted') throw error('provider_not_accepted', false, true);
    return { reference: receipt.id };
  }
  const scenario = job.simulation;
  if (scenario === 'permanent_failure') throw error('provider_permanent');
  if (scenario === 'temporary_outage') throw error('provider_temporary', false, true);
  if (scenario === 'transient_failure' && job.attemptCount === 1)
    throw error('provider_temporary', false, true);
  if (scenario === 'unknown' && job.attemptCount === 1) throw error('provider_timeout', true);
  if (scenario === 'timeout_before_accept' && job.attemptCount === 1) throw error('provider_timeout', true);
  const now = new Date();
  try {
    receipt = await MockReceipt.create({
      providerKey: message.idempotencyKey,
      jobId: job._id,
      editionId: job.editionId,
      channel: message.channel,
      recipient: message.to,
      payloadHash: digest,
      attachmentSha256: message.attachment.sha256,
      attachmentSize: message.attachment.bytes.length,
      filename: message.attachment.filename,
      contentType: 'application/pdf',
      state:
        scenario === 'delivered' ? 'delivered' : scenario === 'bounced' ? 'bounced' : 'provider_accepted',
      acceptedAt: now,
      statusAt: now
    });
  } catch (failure) {
    if (failure.code !== 11000) throw failure;
    receipt = await MockReceipt.findOne({ providerKey: message.idempotencyKey });
    if (receipt.payloadHash !== digest) throw error('provider_key_conflict');
  }
  if (receipt.state === 'not_accepted') throw error('provider_not_accepted', false, true);
  if (scenario === 'timeout_after_accept' && job.attemptCount === 1) throw error('provider_timeout', true);
  return { reference: receipt.id };
}
async function lookup(job) {
  let receipt = await MockReceipt.findOne({ providerKey: job.providerKey });
  if (!receipt && !(job.simulation === 'unknown' && job.attemptCount === 1)) {
    // A definitive negative result seals this provider key. An old worker cannot
    // create an accepted message after reconciliation has authorized a new attempt.
    const stored = await Delivery.findById(job._id).select('+recipient');
    const card = await Card.findById(job.cardId);
    if (!stored || !card) return { found: false, definitive: false };
    try {
      receipt = await MockReceipt.create({
        providerKey: job.providerKey,
        jobId: job._id,
        editionId: job.editionId,
        channel: job.channel,
        recipient: stored.recipient,
        payloadHash: fingerprint({
          to: stored.recipient,
          channel: job.channel,
          sha256: job.pdfSha256,
          filename: `carton-${card.cardCode}.pdf`
        }),
        attachmentSha256: job.pdfSha256,
        attachmentSize: 0,
        filename: `carton-${card.cardCode}.pdf`,
        contentType: 'application/pdf',
        state: 'not_accepted',
        statusAt: new Date()
      });
    } catch (failure) {
      if (failure.code !== 11000) throw failure;
      receipt = await MockReceipt.findOne({ providerKey: job.providerKey });
    }
  }
  if (receipt)
    return {
      found: receipt.state !== 'not_accepted',
      definitive: true,
      state: receipt.state,
      reference: receipt.id,
      acceptedAt: receipt.acceptedAt,
      statusAt: receipt.statusAt
    };
  return { found: false, definitive: false };
}
module.exports = { send, lookup, scenarios };
