const mongoose = require('mongoose');
require('./models/users');
require('./models/admins');
require('./pilot/models');

function bounded(work, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function topologyOk(hello) {
  return Boolean((hello.setName && (hello.isWritablePrimary || hello.ismaster)) || hello.msg === 'isdbgrid');
}

function canonical(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])])
  );
}

async function verifyUniqueIndexes(database) {
  let required = 0;
  for (const model of Object.values(mongoose.models)) {
    const expected = model.schema.indexes().filter(([, options]) => options.unique);
    if (!expected.length) continue;
    const actual = await database.collection(model.collection.name).indexes();
    for (const [keys, options] of expected) {
      required++;
      const found = actual.some(
        (index) =>
          index.unique === true &&
          JSON.stringify(index.key) === JSON.stringify(keys) &&
          Boolean(index.sparse) === Boolean(options.sparse) &&
          JSON.stringify(canonical(index.partialFilterExpression)) ===
            JSON.stringify(canonical(options.partialFilterExpression)) &&
          JSON.stringify(canonical(index.collation)) === JSON.stringify(canonical(options.collation))
      );
      if (!found) throw new Error('Required unique index missing or incompatible');
    }
  }
  return { uniqueIndexes: required };
}

async function databaseHealth(timeoutMs = 1000) {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    return await bounded(async () => {
      const database = mongoose.connection.db;
      await database.command({ ping: 1 }, { timeoutMS: timeoutMs });
      const hello = await database.admin().command({ hello: 1 }, { timeoutMS: timeoutMs });
      return topologyOk(hello);
    }, timeoutMs);
  } catch (_) {
    return false;
  }
}

async function closeServer(server, disconnect, timeoutMs) {
  // A request finishing after server.close() can become a new idle keep-alive socket.
  // Sweep only idle connections while active responses retain the full drain window.
  const idleSweep = setInterval(() => server.closeIdleConnections(), 25);
  idleSweep.unref();
  try {
    await bounded(async () => {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await disconnect();
    }, timeoutMs);
  } catch (error) {
    server.closeAllConnections();
    throw error;
  } finally {
    clearInterval(idleSweep);
  }
}

module.exports = { bounded, topologyOk, verifyUniqueIndexes, databaseHealth, closeServer };
