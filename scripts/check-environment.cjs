// Read-only preflight: never initializes models/indexes or modifies application records.
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { runtimeConfig } = require('../bingo-api/config/runtime');
const { verifyRelease } = require('./release.cjs');
const { topologyOk, verifyUniqueIndexes, bounded } = require('../bingo-api/operations');
const root = path.resolve(__dirname, '..');

function verifyDependencies(directory = root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json')));
  for (const name of Object.keys(pkg.dependencies)) {
    const installed = JSON.parse(fs.readFileSync(path.join(directory, 'node_modules', name, 'package.json')));
    if (installed.version !== lock.packages['node_modules/' + name].version)
      throw new Error('Dependency mismatch');
  }
  return Object.keys(pkg.dependencies).length;
}

async function checkEnvironment(env = process.env) {
  const report = { status: 'failed', node: process.versions.node, checks: {} };
  const check = async (name, work) => {
    try {
      const result = await work();
      report.checks[name] = { status: 'ok', ...(result || {}) };
    } catch (_) {
      report.checks[name] = { status: 'failed' };
    }
  };
  let settings;
  await check('configuration', () => {
    settings = runtimeConfig(env);
  });
  await check('release', () => ({ release: verifyRelease() }));
  await check('dependencies', () => ({ directRuntimeDependencies: verifyDependencies() }));
  if (settings) {
    const client = new mongoose.mongo.MongoClient(env.DB_URI, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      socketTimeoutMS: 3000
    });
    try {
      await check('database', async () => {
        await bounded(() => client.connect(), 4000);
        const database = client.db();
        await database.command({ ping: 1 }, { timeoutMS: 3000 });
        const hello = await database.admin().command({ hello: 1 }, { timeoutMS: 3000 });
        if (!topologyOk(hello)) throw new Error('Unsupported topology');
        const version = await database.admin().command({ buildInfo: 1 }, { timeoutMS: 3000 });
        return {
          topology: hello.msg === 'isdbgrid' ? 'mongos' : 'replicaSet',
          mongoVersion: version.version
        };
      });
      if (report.checks.database.status === 'ok') {
        await check('uniqueIndexes', () => bounded(() => verifyUniqueIndexes(client.db()), 5000));
      }
    } finally {
      await client.close();
    }
  }
  if (!report.checks.database) report.checks.database = { status: 'skipped' };
  if (!report.checks.uniqueIndexes) report.checks.uniqueIndexes = { status: 'skipped' };
  report.status = Object.values(report.checks).every((value) => value.status === 'ok') ? 'ok' : 'failed';
  return report;
}
if (require.main === module) {
  if (process.env.NODE_ENV !== 'test') require('dotenv').config();
  checkEnvironment()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== 'ok') process.exitCode = 1;
    })
    .catch(() => {
      console.error('Environment verification failed');
      process.exitCode = 1;
    });
}
module.exports = { checkEnvironment, verifyDependencies };
