const db = require('../../bingo-api/models/db');
const { recordEvaluatedDraw } = require('../../bingo-api/pilot/persistence');
process.once('message', async ({ uri, command }) => {
  try {
    await db.connect(uri);
    await recordEvaluatedDraw(command, async () => {
      process.send({ uncommitted: true });
      await new Promise(() => {});
    });
  } catch (_) { process.send({ failed: true }); }
});
