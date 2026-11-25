if (Number(process.versions.node.split('.')[0]) !== 22) {
  throw new Error('Use Node 22 (see .nvmrc) before starting the Bingo API');
}
const express = require('express');
const bodyParser = require('body-parser');
const passport = require('passport');
const path = require('path');
// Tests set their own synthetic env vars and must stay hermetic: a local .env (e.g. real
// delivery-provider credentials for manual testing) must never leak into a test run.
if (process.env.NODE_ENV !== 'test') require('dotenv').config();
const db = require('./bingo-api/models/db');
require('./bingo-api/config/passport');
const { networkConfig, corsMiddleware } = require('./bingo-api/config/network');
const { runtimeConfig } = require('./bingo-api/config/runtime');
const { providerConfig } = require('./bingo-api/config/provider');
const { databaseHealth, closeServer, bounded } = require('./bingo-api/operations');
const { releaseInfo } = require('./scripts/release.cjs');

function createApp(settings = networkConfig(), runtime = {}) {
  if (!process.env.DB_SECRET) throw new Error('DB_SECRET is required');
  const app = express();
  runtime.release = runtime.release || { status: 'unverified', version: require('./package.json').version, buildId: null };
  runtime.startedAt = runtime.startedAt || new Date().toISOString();
  app.use(corsMiddleware(settings));
  app.use((req, res, next) => {
    if (runtime.draining && !['/health', '/health/ready', '/health/live', '/version'].includes(req.path)) {
      return res.status(503).json({ message: 'Server shutting down' });
    }
    next();
  });
  // Meta signs this webhook over the raw body; it must be read before bodyParser consumes the stream.
  app.use('/bingo-api', require('./bingo-api/pilot/whatsapp-webhook-routes'));
  app.use(bodyParser.json({ limit: '8mb' }));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(passport.initialize());
  app.use('/bingo-api', require('./bingo-api/routes/index'));
  app.get('/version', (req, res) => res.set('Cache-Control', 'no-store').json(runtime.release));
  app.get('/health/live', (req, res) => res.set('Cache-Control', 'no-store').json({ status: 'alive' }));
  app.get(['/health', '/health/ready'], async (req, res) => {
    const healthy = !runtime.draining && await databaseHealth(runtime.healthTimeoutMs || 1000);
    res.set('Cache-Control', 'no-store').status(healthy ? 200 : 503).json({
      status: runtime.draining ? 'draining' : healthy ? 'ok' : 'not_ready',
      database: healthy ? 'ok' : runtime.draining ? 'not_checked' : 'unavailable',
      release: runtime.release, startedAt: runtime.startedAt
    });
  });
  app.use('/bingo-api', (req, res) => res.status(404).json({ message: 'Not found' }));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.name === 'UnauthorizedError' ? 401 : err.code === 11000 ? 409 :
      err.name === 'ValidationError' || err.name === 'CastError' || err.name === 'StrictModeError' ? 400 : err.status || 500;
    const message = status === 500 ? 'Internal server error' : status === 409 ? 'Conflict: duplicate or stale operation' :
      status === 400 ? 'Invalid request' : err.message;
    const codes = new Set(['csv_encoding', 'csv_size', 'csv_utf8', 'csv_syntax', 'csv_headers', 'csv_empty', 'csv_rows',
      'import_superseded', 'list_frozen', 'import_already_applied', 'import_unresolved', 'reconciliation_incomplete', 'card_variant', 'card_collision', 'card_title', 'card_confirmation_required',
      'card_settings_locked', 'pdf_integrity', 'pdf_missing', 'card_legacy', 'delivery_list_not_final', 'delivery_uncertain', 'delivery_still_pending',
      'delivery_participant_inactive', 'delivery_not_retryable', 'delivery_event_conflict', 'game_configuration', 'game_cross_figure_policy', 'game_mask', 'game_configuration_required',
      'game_round_mode', 'game_extraction_mode', 'game_repeat_winners', 'game_pause_contact', 'game_rounding_policy',
      'game_discard_policy', 'game_no_response_policy', 'game_contact_clock', 'game_mask_review', 'game_confirmation_reference',
      'game_order', 'game_figures_set', 'game_near_miss', 'game_pool_total',
      'game_frozen', 'game_state', 'game_roster_exists', 'game_rounds_complete', 'game_pending_contact', 'game_roster_integrity',
      'game_round_changed', 'game_exhausted', 'game_digital_number', 'game_duplicate', 'game_round_incomplete',
      'contact_state', 'contact_resolved', 'contact_reserve', 'contact_result_closed', 'contact_evidence',
      'contact_recipient', 'contact_response_time', 'contact_response_format', 'contact_not_expired', 'contact_review_required',
      'prize_pending_settlement', 'prize_budget', 'prize_legacy', 'prize_evidence', 'prize_account',
      'prize_account_locked', 'prize_account_duplicate', 'prize_account_missing', 'prize_result_state',
      'prize_pending_responses', 'prize_group', 'prize_response_evidence', 'prize_already_allocated',
      'prize_proposal_stale', 'prize_review', 'prize_exhaustion_review', 'prize_waiting_candidates',
      'prize_continuation_state', 'prize_credit', 'prize_credit_date', 'prize_already_credited', 'prize_credit_duplicate']);
    res.status(status).json({ message, ...(codes.has(err.publicCode) ? { code: err.publicCode } : {}) });
  });
  return app;
}

async function start() {
  const settings = runtimeConfig();
  providerConfig();
  const runtime = { release: releaseInfo(settings.mode === 'production'), healthTimeoutMs: settings.healthTimeoutMs };
  const app = createApp(settings, runtime);
  await bounded(() => db.connect(process.env.DB_URI), settings.startupTimeoutMs);
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(settings.port, settings.host, () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`Bingo API listening on ${server.address().port}`);
  console.log(JSON.stringify({ event: 'api.started', release: runtime.release, startedAt: runtime.startedAt }));
  let closing;
  const shutdown = () => {
    if (closing) return closing;
    runtime.draining = true;
    closing = closeServer(server, () => db.disconnect(), settings.shutdownTimeoutMs).then(() => {
      process.removeListener('SIGINT', signalShutdown);
      process.removeListener('SIGTERM', signalShutdown);
      console.log(JSON.stringify({ event: 'api.stopped', buildId: runtime.release.buildId }));
    });
    return closing;
  };
  const signalShutdown = () => shutdown().catch(() => {
    console.error('Bingo API shutdown exceeded its deadline or failed');
    process.exit(1);
  });
  process.on('SIGINT', signalShutdown);
  process.on('SIGTERM', signalShutdown);
  server.shutdown = shutdown;
  return server;
}

if (require.main === module) start().catch(async () => {
  // Do not print connection strings or credentials on failure.
  console.error('Bingo API could not start. Check configuration, Node 22, release build, MongoDB topology and indexes.');
  await db.disconnect();
  process.exitCode = 1;
});
module.exports = { createApp, start };
