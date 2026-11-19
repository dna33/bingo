if (process.env.NODE_ENV !== 'test') require('dotenv').config();
const db = require('../bingo-api/models/db');
const { DeliveryControl } = require('../bingo-api/pilot/models');
const { processBatch } = require('../bingo-api/pilot/deliveries');
const { providerConfig } = require('../bingo-api/config/provider');
const { status } = require('../bingo-api/pilot/provider-registry');
let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });
(async () => {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Node 22 required');
  providerConfig();
  await db.connect(process.env.DB_URI);
  console.log(`Persistent PDF delivery worker. Providers: ${JSON.stringify(status())}`);
  do {
    const controls = await DeliveryControl.find().select('editionId');
    for (const control of controls) {
      if (stopping) break;
      await processBatch(control.editionId, { limit: 25 });
    }
    if (process.argv.includes('--once')) break;
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 100));
  } while (!stopping);
})().catch(() => {
  console.error('Simulated worker failed. Pending jobs are preserved; check the replica set.'); process.exitCode = 1;
}).finally(() => db.disconnect());
