require('dotenv').config();
const fs = require('node:fs');
const db = require('../bingo-api/models/db');
const { provision } = require('../bingo-api/pilot/staff');
(async () => {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Node 22 required');
  // Credentials travel via stdin, never command-line arguments or console output.
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  await db.connect(process.env.DB_URI);
  const { id } = await provision(input);
  console.log(`Staff account provisioned: ${id}`);
})().catch(() => {
  console.error('Provisioning failed. Check the replica set and input fields; no changes are committed on failure.');
  process.exitCode = 1;
}).finally(() => db.disconnect());
