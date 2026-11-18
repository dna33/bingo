const fs = require('node:fs/promises');
const path = require('node:path');
const { networkConfig } = require('../bingo-api/config/network');
const { publicNetwork } = require('../config/public-network');

async function writeClientConfig(env = process.env, directory = path.join(__dirname, '../build')) {
  const settings = publicNetwork(networkConfig(env));
  // Only the two public URLs are serialized, never the environment or DB credentials.
  const json = JSON.stringify(settings).replace(/</g, '\\u003c');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'runtime-config.js'), `window.BINGO_CONFIG = ${json};\n`);
}

if (require.main === module) {
  require('dotenv').config();
  writeClientConfig().catch(() => {
    console.error('Client configuration failed. Check CONSOLE_URL, API_BASE_URL and CORS_ALLOWED_ORIGINS.');
    process.exitCode = 1;
  });
}
module.exports = { writeClientConfig };
