const nodemailer = require('nodemailer');
const { sha256 } = require('../cards');
const { SmtpReceipt } = require('./provider-receipts');

function invalid(code) {
  return Object.assign(new Error(code), { providerCode: code, uncertain: false, retryable: false });
}

// Generic SMTP has no feedback loop beyond the initial relay response: lookup() can only ever
// confirm 'provider_accepted'. Confirming real 'delivered'/'bounced' would require a monitored
// DSN bounce mailbox or a provider-specific webhook, which is deliberately out of scope here
// (SMTP was chosen precisely to stay independent of any one vendor's proprietary integration).
function classify(error) {
  const code = error && error.responseCode;
  if (!code) return { providerCode: 'smtp_timeout', uncertain: true, retryable: false };
  if (code >= 500) return { providerCode: 'smtp_rejected', uncertain: false, retryable: false };
  if (code >= 400) return { providerCode: 'smtp_temporary_reject', uncertain: false, retryable: true };
  return { providerCode: 'smtp_unknown', uncertain: true, retryable: false };
}

module.exports = function createSmtpProvider(config, deps = {}) {
  const createTransport = deps.createTransport || nodemailer.createTransport;
  let transport;
  function transportFor() {
    if (!transport) {
      transport = config.sandbox
        ? createTransport({ jsonTransport: true })
        : createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: { user: config.user, pass: config.pass }
          });
    }
    return transport;
  }
  async function send(message, job) {
    if (typeof message.to !== 'string' || !message.to || message.cc || message.bcc) throw invalid('invalid_message');
    if (
      !Buffer.isBuffer(message.attachment.bytes) ||
      sha256(message.attachment.bytes) !== message.attachment.sha256 ||
      message.attachment.contentType !== 'application/pdf'
    )
      throw invalid('invalid_attachment');
    let receipt = await SmtpReceipt.findOne({ providerKey: message.idempotencyKey });
    if (receipt) return { reference: receipt.reference };
    let info;
    try {
      info = await transportFor().sendMail({
        from: config.from,
        to: message.to,
        subject: 'Tu cartón de Bingo Fabuloso',
        text: 'Adjuntamos tu cartón en PDF. Sigue el bingo por YouTube; el sistema detecta tu cartón automáticamente.',
        attachments: [
          { filename: message.attachment.filename, content: message.attachment.bytes, contentType: 'application/pdf' }
        ]
      });
    } catch (error) {
      throw Object.assign(new Error(error.message || 'smtp_send_failed'), classify(error));
    }
    const reference = info.messageId || `smtp-${message.idempotencyKey}`;
    try {
      receipt = await SmtpReceipt.create({
        providerKey: message.idempotencyKey,
        jobId: job._id,
        channel: message.channel,
        state: 'sent',
        reference,
        sentAt: new Date()
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      receipt = await SmtpReceipt.findOne({ providerKey: message.idempotencyKey });
    }
    return { reference: receipt.reference };
  }
  async function lookup(job) {
    const receipt = await SmtpReceipt.findOne({ providerKey: job.providerKey });
    if (!receipt) return { found: false, definitive: false };
    return {
      found: true,
      definitive: true,
      state: 'provider_accepted',
      reference: receipt.reference,
      acceptedAt: receipt.sentAt,
      statusAt: receipt.sentAt
    };
  }
  return { send, lookup };
};
