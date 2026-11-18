const mongoose = require('mongoose');
const { createHash, randomUUID } = require('node:crypto');
const { Edition, Command, Audit } = require('./models');
const failure = require('./errors');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function replay(receipt, digest) {
  if (receipt.fingerprint !== digest) throw failure(409, 'Idempotency key already used for a different command');
  return receipt.result;
}
async function audit(session, data) {
  // Deliberately no arbitrary payload: contacts, secrets and raw input cannot enter the audit log.
  const { editionId, actorId, actorKind = 'staff', action, resourceId, commandKey, version, sequence, changedFields = [] } = data;
  await Audit.create([{ eventId: randomUUID(), occurredAt: new Date(), editionId, actorId, actorKind,
    action, resourceId, commandKey, version, sequence, changedFields }], { session });
}
async function execute({ editionId, key, expectedVersion, actorId, action, input }, work) {
  if (!mongoose.isValidObjectId(editionId) || !mongoose.isValidObjectId(actorId)) throw failure(400, 'Invalid identifier');
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw failure(400, 'An idempotency key of 8–100 safe characters is required');
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw failure(400, 'expectedVersion must be a nonnegative integer');
  const digest = fingerprint({ action, actorId: String(actorId), expectedVersion, input });
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const receipt = await Command.findOne({ editionId, key }).session(session);
      if (receipt) { result = replay(receipt, digest); return; }
      // This CAS serializes commands across processes, not merely inside one Node instance.
      const edition = await Edition.findOneAndUpdate({ _id: editionId, version: expectedVersion },
        { $inc: { version: 1 } }, { new: true, session });
      if (!edition) throw failure(409, 'Edition missing or version is stale');
      result = await work({ session, edition });
      await audit(session, { editionId, actorId, action, resourceId: editionId,
        commandKey: key, version: edition.version });
      await Command.create([{ editionId, key, fingerprint: digest, actorId, action, result }], { session });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } catch (error) {
    // A racing retry can lose on the unique receipt index after the other transaction commits.
    if (error.code === 11000) {
      const receipt = await Command.findOne({ editionId, key });
      if (receipt) return replay(receipt, digest);
    }
    throw error;
  } finally { await session.endSession(); }
}
module.exports = { execute, audit, fingerprint };
