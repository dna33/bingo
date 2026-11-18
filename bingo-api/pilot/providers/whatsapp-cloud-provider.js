const { randomUUID } = require('node:crypto');
const { sha256 } = require('../cards');
const { WhatsAppReceipt } = require('./provider-receipts');

function invalid(code) {
  return Object.assign(new Error(code), { providerCode: code, uncertain: false, retryable: false });
}

// Minimal multipart/form-data encoder, kept dependency-free: node-fetch@2 only recognizes the
// `form-data` package's object shape for multipart bodies, and adding that package just to
// upload one PDF per message would be a second dependency for no real benefit.
function multipartBody(fields) {
  const boundary = `----bingo-${randomUUID()}`;
  const chunks = [];
  for (const field of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (field.filename) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n` +
            `Content-Type: ${field.contentType}\r\n\r\n`
        )
      );
      chunks.push(field.value);
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}`));
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function networkFailure() {
  return Object.assign(new Error('whatsapp_timeout'), {
    providerCode: 'whatsapp_timeout',
    uncertain: true,
    retryable: false
  });
}

async function graphError(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    // Non-JSON error body from the Graph API; fall back to the HTTP status alone.
  }
  const code = body && body.error && body.error.code;
  return Object.assign(new Error((body.error && body.error.message) || 'whatsapp_api_error'), {
    providerCode: `whatsapp_${code || response.status}`,
    uncertain: false,
    retryable: response.status >= 500
  });
}

async function createReceipt(fields) {
  try {
    return await WhatsAppReceipt.create(fields);
  } catch (error) {
    if (error.code !== 11000) throw error;
    return await WhatsAppReceipt.findOne({ providerKey: fields.providerKey });
  }
}

// Every send here is business-initiated by Fabuloso, never a reply to the participant, so Meta
// requires a pre-approved message template for the first contact: there is no free-form fallback.
module.exports = function createWhatsAppCloudProvider(config, deps = {}) {
  const fetch = deps.fetch || require('node-fetch');
  const endpoint = (path) => `${config.apiBaseUrl}/${config.apiVersion}/${path}`;
  const authHeaders = (extra = {}) => ({ Authorization: `Bearer ${config.accessToken}`, ...extra });

  async function uploadMedia(message) {
    const { body, contentType } = multipartBody([
      { name: 'messaging_product', value: 'whatsapp' },
      {
        name: 'file',
        value: message.attachment.bytes,
        filename: message.attachment.filename,
        contentType: 'application/pdf'
      }
    ]);
    let response;
    try {
      response = await fetch(endpoint(`${config.phoneNumberId}/media`), {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': contentType }),
        body
      });
    } catch {
      throw networkFailure();
    }
    if (!response.ok) throw await graphError(response);
    return (await response.json()).id;
  }

  async function sendTemplate(message, mediaId) {
    let response;
    try {
      response = await fetch(endpoint(`${config.phoneNumberId}/messages`), {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'template',
          template: {
            name: config.templateName,
            language: { code: config.templateLang },
            components: [
              {
                type: 'header',
                parameters: [{ type: 'document', document: { id: mediaId, filename: message.attachment.filename } }]
              }
            ]
          }
        })
      });
    } catch {
      throw networkFailure();
    }
    if (!response.ok) throw await graphError(response);
    return (await response.json()).messages[0].id;
  }

  async function send(message, job) {
    if (typeof message.to !== 'string' || !message.to || message.cc || message.bcc) throw invalid('invalid_message');
    if (
      !Buffer.isBuffer(message.attachment.bytes) ||
      sha256(message.attachment.bytes) !== message.attachment.sha256 ||
      message.attachment.contentType !== 'application/pdf'
    )
      throw invalid('invalid_attachment');
    const existing = await WhatsAppReceipt.findOne({ providerKey: message.idempotencyKey });
    if (existing) return { reference: existing.wamid };
    const wamid = config.sandbox ? `sandbox-${randomUUID()}` : await sendTemplate(message, await uploadMedia(message));
    const receipt = await createReceipt({
      providerKey: message.idempotencyKey,
      jobId: job._id,
      channel: message.channel,
      state: 'accepted',
      wamid,
      sentAt: new Date()
    });
    return { reference: receipt.wamid };
  }

  async function lookup(job) {
    const receipt = await WhatsAppReceipt.findOne({ providerKey: job.providerKey });
    if (!receipt) return { found: false, definitive: false };
    const state = { accepted: 'provider_accepted', delivered: 'delivered', read: 'delivered', failed: 'bounced' }[
      receipt.state
    ];
    return {
      found: true,
      definitive: true,
      state,
      reference: receipt.wamid,
      acceptedAt: receipt.sentAt,
      statusAt: receipt.statusAt || receipt.sentAt
    };
  }

  return { send, lookup };
};
