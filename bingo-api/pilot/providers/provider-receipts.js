const mongoose = require('mongoose');
const { Schema } = mongoose;
function model(name, fields, indexes = []) {
  const schema = new Schema(fields, { timestamps: true, strict: 'throw' });
  indexes.forEach(([keys, options]) => schema.index(keys, options));
  return mongoose.model(name, schema);
}
const unique = { unique: true };
const text = { type: String, required: true, trim: true };
const id = { type: Schema.Types.ObjectId, required: true };

// A local, provider-specific receipt written synchronously inside send(), before it returns.
// Neither SMTP nor the WhatsApp Cloud API accepts a client idempotency key or exposes a
// poll-by-id status endpoint, so without this record a crash between a real provider accepting
// the message and this process recording that fact would leave the delivery job uncertain forever.
const SmtpReceipt = model(
  'PilotSmtpReceipt',
  {
    providerKey: text,
    jobId: id,
    channel: text,
    state: { type: String, enum: ['sent', 'failed'], required: true },
    reference: text,
    sentAt: { type: Date, required: true }
  },
  [[{ providerKey: 1 }, unique]]
);

const WhatsAppReceipt = model(
  'PilotWhatsAppReceipt',
  {
    providerKey: text,
    jobId: id,
    channel: text,
    state: { type: String, enum: ['accepted', 'delivered', 'read', 'failed'], required: true },
    wamid: text,
    sentAt: { type: Date, required: true },
    statusAt: Date
  },
  [[{ providerKey: 1 }, unique], [{ wamid: 1 }, unique]]
);

module.exports = { SmtpReceipt, WhatsAppReceipt };
