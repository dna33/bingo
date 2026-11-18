const mongoose = require('mongoose');
const { Schema } = mongoose;
const id = { type: Schema.Types.ObjectId, required: true };
const text = { type: String, required: true, trim: true };
const integer = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
function model(name, fields, indexes = []) {
  const schema = new Schema(fields, { timestamps: true, strict: 'throw' });
  if (['PilotAudit', 'PilotContactEvent', 'PilotPrizeSettlement', 'PilotPrizeCredit'].includes(name)) {
    for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
      schema.pre(operation, { document: operation === 'deleteOne', query: true }, function () { throw new Error('Audit events are append-only'); });
    }
    schema.pre('save', function () { if (!this.isNew) throw new Error('Audit events are append-only'); });
  }
  if (name === 'PilotImport') {
    schema.pre('validate', function () {
      if (this.isNew && this.originalFile) this.sourceHash = require('node:crypto').createHash('sha256').update(this.originalFile).digest('hex');
    });
  }
  if (name === 'PilotCard') {
    schema.pre('validate', function () {
      this.layoutHash = require('node:crypto').createHash('sha256').update(JSON.stringify(this.cells)).digest('hex');
    });
  }
  indexes.forEach(([keys, options]) => schema.index(keys, options));
  return mongoose.model(name, schema);
}
const unique = { unique: true };
const Edition = model('PilotEdition', {
  name: text,
  state: { type: String, enum: ['preparation', 'ready', 'playing', 'paused', 'finished'], default: 'preparation' },
  version: { ...integer, default: 0 },
  // Rules are stored as a versioned snapshot; stage 5 will validate full game semantics.
  rules: { type: Schema.Types.Mixed, default: {} },
  gameConfigurationId: Schema.Types.ObjectId, currentRoundId: Schema.Types.ObjectId,
  gamePreparedAt: Date, gameStartedAt: Date, gameFinishedAt: Date,
  cardSettings: Schema.Types.Mixed,
  cardSettingsLockedAt: Date,
  approvedImportId: Schema.Types.ObjectId,
  listClosedAt: Date, listClosedBy: Schema.Types.ObjectId,
  createdBy: id
});
const ConfigVersion = model('PilotConfiguration', { editionId: id, version: integer, rules: { type: Schema.Types.Mixed, required: true }, createdBy: id }, [[{ editionId: 1, version: 1 }, unique]]);
const ImportVersion = model('PilotImport', {
  editionId: id, version: integer, sourceHash: { ...text, immutable: true }, originalFile: { type: Buffer, required: true, select: false, immutable: true },
  filename: text, sourceReference: String, status: { type: String, enum: ['staged', 'applied'], default: 'staged' }, receivedAt: { type: Date, required: true }, approvedAt: Date, approvedBy: Schema.Types.ObjectId
}, [[{ editionId: 1, version: 1 }, unique], [{ editionId: 1, sourceHash: 1 }, unique]]);
const ImportRow = model('PilotImportRow', {
  editionId: id, importId: id, rowNumber: { ...integer, min: 1 },
  raw: { type: Schema.Types.Mixed, required: true, select: false },
  status: { type: String, enum: ['pending', 'valid', 'invalid', 'duplicate', 'conflict', 'resolved'], default: 'pending' },
  resolution: { type: String, select: false }, participantId: Schema.Types.ObjectId,
  structureIssues: [String], issues: [String], duplicateOfRowId: Schema.Types.ObjectId,
  decision: { type: Schema.Types.Mixed, select: false }, decisions: { type: [Schema.Types.Mixed], select: false },
  outcome: { type: String, enum: ['included', 'excluded'] }
}, [[{ importId: 1, rowNumber: 1 }, unique]]);
const Participant = model('PilotParticipant', {
  editionId: id, sourceRowId: id, externalId: String, participantKey: text,
  name: { type: String, select: false }, email: { ...text, select: false }, phone: { ...text, select: false },
  active: { type: Boolean, default: true },
  contactHistory: { type: [Schema.Types.Mixed], select: false },
  activityHistory: { type: [Schema.Types.Mixed], select: false }
}, [[{ editionId: 1, participantKey: 1 }, unique], [{ editionId: 1, sourceRowId: 1 }, unique], [{ editionId: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } }]]);
const Card = model('PilotCard', {
  editionId: { ...id, immutable: true }, participantId: { ...id, immutable: true },
  sourceRowId: { ...id, immutable: true }, cardCode: { ...text, immutable: true }, layoutHash: text,
  cells: { type: [Number], default: undefined, required: true, immutable: true, validate: {
    validator: cells => cells.length === 25 && cells[12] === null &&
      cells.filter((_, i) => i !== 12).every(n => Number.isSafeInteger(n) && n > 0) &&
      new Set(cells.filter((_, i) => i !== 12)).size === 24,
    message: 'A card needs 24 distinct positive integers and a null center'
  } },
  generation: { type: Schema.Types.Mixed, immutable: true },
  presentation: { type: Schema.Types.Mixed, immutable: true },
  pdf: { storageKey: String, sha256: String }
}, [[{ editionId: 1, participantId: 1 }, unique], [{ editionId: 1, layoutHash: 1 }, unique], [{ cardCode: 1 }, unique]]);
const CardPdf = model('PilotCardPdf', {
  editionId: { ...id, immutable: true }, cardId: { ...id, immutable: true },
  bytes: { type: Buffer, required: true, select: false, immutable: true },
  sha256: { ...text, immutable: true }, templateVersion: { ...integer, immutable: true }
}, [[{ cardId: 1 }, unique]]);
const Round = model('PilotRound', {
  editionId: id, ordinal: integer, state: { type: String, enum: ['ready', 'playing', 'paused', 'finished'], default: 'ready' },
  lastSequence: { ...integer, default: 0 }, rulesVersion: integer,
  minNumber: { ...integer, min: 1 }, maxNumber: { ...integer, min: 1 },
  gameConfigurationId: Schema.Types.ObjectId, figures: [String], progress: Schema.Types.Mixed, pauseReason: String, startedAt: Date, finishedAt: Date
}, [[{ editionId: 1, ordinal: 1 }, unique]]);
const Draw = model('PilotDraw', {
  editionId: id, roundId: id, sequence: { ...integer, min: 1 }, number: { ...integer, min: 1 },
  drawnAt: { type: Date, required: true }, operatorId: id,
  origin: { type: String, enum: ['manual', 'digital'], required: true },
  evaluationComplete: { type: Boolean, required: true }, evaluatedCards: Number, candidateCount: Number
}, [[{ roundId: 1, number: 1 }, unique], [{ roundId: 1, sequence: 1 }, unique]]);
const Candidate = model('PilotCandidate', {
  editionId: id, roundId: id, drawId: id, participantId: id, cardId: id,
  figure: text, maskVersion: integer,
  allocationCycle: { ...integer, default: 0 }, promotedAt: Date,
  settledAt: Date, settledProposalId: Schema.Types.ObjectId, allocatedClp: Number,
  cohort: { type: String, enum: ['primary', 'reserve'], default: 'primary' },
  state: { type: String, enum: ['detected', 'contacting', 'awaiting_response', 'confirmed', 'discarded', 'delivered'], default: 'detected' },
  evidence: { type: Schema.Types.Mixed, required: true },
  contactStartedAt: Date, expiresAt: Date, responseReceivedAt: Date,
  resolvedAt: Date, resolvedBy: Schema.Types.ObjectId, resolution: String,
  channel: { type: String, enum: ['email', 'whatsapp'] },
  recipient: { type: String, select: false }, contactedBy: Schema.Types.ObjectId,
  responseEvidence: { type: String, select: false }
}, [[{ roundId: 1, figure: 1, cardId: 1 }, unique], [{ editionId: 1, roundId: 1, cohort: 1, createdAt: 1 }, {}], [{ editionId: 1, state: 1, cohort: 1 }, {}]]);
const CandidateAlert = model('PilotCandidateAlert', {
  editionId: id, roundId: id, drawId: id, figure: text,
  cohort: { type: String, enum: ['primary', 'reserve'], required: true },
  candidateCount: integer, sequence: integer,
  acknowledgedAt: Date, acknowledgedBy: Schema.Types.ObjectId
}, [[{ drawId: 1, figure: 1, cohort: 1 }, unique], [{ editionId: 1, acknowledgedAt: 1, createdAt: 1 }, {}]]);
const ContactEvent = model('PilotContactEvent', {
  editionId: id, candidateId: id, actorId: id, action: text,
  occurredAt: { type: Date, required: true },
  channel: String, recipient: { type: String, select: false },
  evidence: { type: String, select: false }, receivedAt: Date,
  previousState: String, nextState: String
}, [[{ editionId: 1, candidateId: 1, occurredAt: 1 }, {}]]);
const GameConfiguration = model('PilotGameConfiguration', {
  editionId: id, version: integer, rules: { type: Schema.Types.Mixed, required: true, immutable: true },
  confirmationReference: { ...text, select: false }, confirmedBy: id, confirmedAt: { type: Date, required: true }
}, [[{ editionId: 1, version: 1 }, unique]]);
const GameRoster = model('PilotGameRoster', {
  editionId: id, participantId: { ...id, immutable: true }, cardId: { ...id, immutable: true },
  sourceRowId: { ...id, immutable: true }, cells: { type: [Number], default: undefined, required: true, immutable: true },
  layoutHash: { ...text, immutable: true }, pdfSha256: { ...text, immutable: true }
}, [[{ editionId: 1, cardId: 1 }, unique], [{ editionId: 1, participantId: 1 }, unique]]);
const FigureResult = model('PilotFigureResult', {
  editionId: id, roundId: id, gameConfigurationId: id, figure: text, poolClp: integer,
  state: { type: String, enum: ['open', 'detected', 'adjudicated', 'unassigned'], default: 'open' },
  allocationCycle: { ...integer, default: 0 },
  firstDrawId: Schema.Types.ObjectId, firstSequence: Number, primaryCandidateCount: { ...integer, default: 0 },
  reserveCandidateCount: { ...integer, default: 0 }
}, [[{ roundId: 1, figure: 1 }, unique]]);
const GameIncident = model('PilotGameIncident', {
  editionId: id, roundId: Schema.Types.ObjectId, drawId: Schema.Types.ObjectId,
  operatorId: id, kind: { type: String, enum: ['entry_error', 'operation', 'recovery', 'finalization'], required: true },
  reason: { ...text, select: false }, occurredAt: { type: Date, required: true }
});
const Award = model('PilotAward', {
  editionId: id, operationKey: text, candidateId: id, poolKey: text,
  amountClp: integer, state: { type: String, enum: ['confirmed', 'delivered'], required: true },
  confirmedAt: { type: Date, required: true }, confirmedBy: id, deliveredAt: Date,
  poolId: Schema.Types.ObjectId, proposalId: Schema.Types.ObjectId, participantId: Schema.Types.ObjectId,
  sourceRowId: Schema.Types.ObjectId, figure: String, allocationCycle: Number,
  accountReference: { type: String, select: false, immutable: true }
}, [[{ editionId: 1, operationKey: 1 }, unique], [{ candidateId: 1 }, unique]]);
const PrizePool = model('PilotPrizePool', {
  editionId: id, figure: text, totalClp: integer,
  allocatedClp: { ...integer, default: 0 }, deliveredClp: { ...integer, default: 0 },
  unassignedClp: { ...integer, default: 0 }
}, [[{ editionId: 1, figure: 1 }, unique]]);
const PollaAccount = model('PilotPollaAccount', {
  editionId: id, participantId: id,
  accountReference: { ...text, select: false }, accountHash: text,
  verificationEvidence: { ...text, select: false }, verifiedAt: { type: Date, required: true }, verifiedBy: id
}, [[{ editionId: 1, participantId: 1 }, unique], [{ editionId: 1, accountHash: 1 }, unique]]);
const PrizeProposal = model('PilotPrizeProposal', {
  editionId: id, poolId: id, resultId: id, cycle: integer,
  snapshotHash: text, basis: { type: Schema.Types.Mixed, required: true, select: false },
  split: { type: Schema.Types.Mixed, required: true },
  accounts: { type: Schema.Types.Mixed, required: true, select: false },
  seed: { ...text, immutable: true }, algorithm: text,
  allocatedClp: integer, remainderClp: integer, disposition: text,
  confirmedAt: Date, confirmedBy: Schema.Types.ObjectId, preparedBy: id, reason: { ...text, select: false }
}, [[{ resultId: 1, cycle: 1 }, unique]]);
const PrizeSettlement = model('PilotPrizeSettlement', {
  editionId: id, poolId: id, proposalId: id, resultId: id, cycle: integer,
  availableBeforeClp: integer, allocatedClp: integer, unassignedClp: integer,
  availableAfterClp: integer, disposition: text, sourceProposalId: Schema.Types.ObjectId,
  reason: text, actorId: id, occurredAt: { type: Date, required: true }
}, [[{ proposalId: 1 }, unique], [{ editionId: 1, poolId: 1, occurredAt: 1 }, {}]]);
const PrizeCredit = model('PilotPrizeCredit', {
  editionId: id, awardId: id, poolId: id, participantId: id,
  amountClp: integer, accountReference: { ...text, select: false },
  reference: { ...text, select: false }, referenceHash: text,
  evidence: { ...text, select: false }, creditedAt: { type: Date, required: true },
  recordedAt: { type: Date, required: true }, recordedBy: id,
  destination: { type: String, enum: ['polla.cl'], required: true }
}, [[{ awardId: 1 }, unique], [{ editionId: 1, referenceHash: 1 }, unique]]);
const SendAttempt = model('PilotSendAttempt', {
  editionId: id, participantId: id, cardId: id, operationKey: text, attempt: { ...integer, min: 1 },
  channel: { type: String, enum: ['email', 'whatsapp'], required: true },
  recipient: { ...text, select: false }, providerReference: { type: String, select: false },
  state: { type: String, enum: ['pending', 'processing', 'uncertain', 'provider_accepted', 'delivered', 'bounced', 'failed'], required: true },
  jobId: Schema.Types.ObjectId, providerKey: String, pdfSha256: String,
  retryable: Boolean, errorCode: String, completedAt: Date,
  attemptedAt: { type: Date, required: true }
}, [[{ editionId: 1, operationKey: 1, attempt: 1 }, unique]]);
const Delivery = model('PilotDelivery', {
  editionId: id, participantId: { ...id, immutable: true }, cardId: { ...id, immutable: true },
  sourceRowId: { ...id, immutable: true }, queueKey: { ...text, immutable: true },
  kind: { type: String, enum: ['initial', 'resend'], required: true }, parentId: Schema.Types.ObjectId,
  channel: { type: String, enum: ['email', 'whatsapp'], required: true, immutable: true },
  recipient: { ...text, select: false, immutable: true }, pdfSha256: { ...text, immutable: true },
  reason: { type: String, select: false }, retryHistory: { type: [Schema.Types.Mixed], select: false }, createdBy: id,
  simulation: { type: String, required: true },
  state: { type: String, enum: ['pending', 'processing', 'uncertain', 'provider_accepted', 'delivered', 'bounced', 'failed'], default: 'pending' },
  attemptCount: { ...integer, default: 0 }, nextAttemptAt: { type: Date, required: true },
  leaseToken: String, leaseUntil: Date, providerKey: String,
  retryable: { type: Boolean, default: false }, errorCode: String, lastCheckedAt: { type: Date, default: () => new Date(0) },
  providerReference: { type: String, select: false }, acceptedAt: Date, deliveredAt: Date, bouncedAt: Date
}, [[{ editionId: 1, queueKey: 1 }, unique], [{ editionId: 1, state: 1, nextAttemptAt: 1 }, {}]]);
const DeliveryControl = model('PilotDeliveryControl', {
  editionId: id, nextDispatchAt: { type: Date, required: true }
}, [[{ editionId: 1 }, unique]]);
const MockReceipt = model('PilotMockReceipt', {
  providerKey: text, jobId: id, editionId: id, channel: text,
  recipient: { ...text, select: false }, payloadHash: text, attachmentSha256: text,
  attachmentSize: integer, filename: text, contentType: text,
  state: { type: String, enum: ['provider_accepted', 'delivered', 'bounced', 'not_accepted'], required: true },
  acceptedAt: Date, statusAt: { type: Date, required: true }
}, [[{ providerKey: 1 }, unique]]);
const DeliveryEvent = model('PilotDeliveryEvent', {
  editionId: id, jobId: id, eventKey: text, fingerprint: text, status: text
}, [[{ editionId: 1, eventKey: 1 }, unique]]);
const Command = model('PilotCommand', {
  editionId: id, key: text, fingerprint: text, actorId: id, action: text,
  result: { type: Schema.Types.Mixed, required: true }
}, [[{ editionId: 1, key: 1 }, unique]]);
const Audit = model('PilotAudit', {
  eventId: text, editionId: Schema.Types.ObjectId, actorId: Schema.Types.ObjectId,
  actorKind: { type: String, enum: ['staff', 'bootstrap', 'worker'], required: true },
  action: text, resourceId: id, commandKey: String,
  version: Number, sequence: Number, changedFields: [String], occurredAt: { type: Date, required: true }
}, [[{ eventId: 1 }, unique], [{ editionId: 1, occurredAt: 1 }, {}]]);
module.exports = { Edition, ConfigVersion, ImportVersion, ImportRow, Participant, Card, CardPdf, Round, Draw, Candidate, CandidateAlert, ContactEvent, GameConfiguration, GameRoster, FigureResult, GameIncident, Award, PrizePool, PollaAccount, PrizeProposal, PrizeSettlement, PrizeCredit, SendAttempt, Delivery, DeliveryControl, MockReceipt, DeliveryEvent, Command, Audit };
