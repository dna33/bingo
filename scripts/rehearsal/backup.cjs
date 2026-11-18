const fs = require('node:fs/promises');
const { createWriteStream, createReadStream } = require('node:fs');
const path = require('node:path');
const { createGzip, createGunzip } = require('node:zlib');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { finished, pipeline } = require('node:stream/promises');
const { BSON } = require('mongodb');
async function sha(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
// Lab backup only: caller must stop all writers. Do not use as an online production backup.
async function backup(db, directory, { writersStopped = false } = {}) {
  if (!writersStopped) throw new Error('Stop API and workers before lab backup');
  await fs.mkdir(directory, { recursive: false, mode: 0o700 });
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
  const manifest = {
    version: 1,
    format: 'concatenated-bson-gzip',
    quiescent: true,
    sourceDatabase: db.databaseName,
    createdAt: new Date().toISOString(),
    collections: []
  };
  const session = db.client.startSession();
  try {
    session.startTransaction({ readConcern: { level: 'snapshot' } });
    for (const [i, name] of collections.entries()) {
      const filename = `${String(i).padStart(3, '0')}.bson.gz`,
        target = path.join(directory, filename);
      const gzip = createGzip(),
        output = createWriteStream(target, { flags: 'wx', mode: 0o600 });
      const done = pipeline(gzip, output);
      let count = 0;
      const rawHash = createHash('sha256');
      try {
        for await (const doc of db.collection(name).find({}, { session }).sort({ _id: 1 })) {
          const bytes = BSON.serialize(doc);
          rawHash.update(bytes);
          if (!gzip.write(bytes)) await once(gzip, 'drain');
          count++;
        }
        gzip.end();
        await done;
      } catch (error) {
        gzip.destroy(error);
        await done.catch(() => {});
        throw error;
      }
      const indexes = await db.collection(name).listIndexes().toArray();
      manifest.collections.push({
        name,
        filename,
        count,
        indexes,
        sha256: await sha(target),
        rawSha256: rawHash.digest('hex'),
        compressedBytes: (await fs.stat(target)).size
      });
    }
    await session.commitTransaction();
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      flag: 'wx',
      mode: 0o600
    });
    return manifest;
  } finally {
    if (session.inTransaction()) await session.abortTransaction();
    await session.endSession();
  }
}
async function restore(db, directory) {
  if ((await db.listCollections({}, { nameOnly: true }).toArray()).length)
    throw new Error('Restore target must be empty; no overwrite or drop is allowed');
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.format !== 'concatenated-bson-gzip' || !manifest.quiescent)
    throw new Error('Unsupported backup');
  // Verify every file before writing the empty destination.
  for (const entry of manifest.collections) {
    if (
      !/^\d{3}\.bson\.gz$/.test(entry.filename) ||
      !/^[a-zA-Z0-9_.-]+$/.test(entry.name) ||
      (await sha(path.join(directory, entry.filename))) !== entry.sha256
    )
      throw new Error('Backup checksum or path mismatch');
  }
  for (const entry of manifest.collections) {
    await db.createCollection(entry.name);
    let buffer = Buffer.alloc(0),
      batch = [],
      count = 0;
    const stream = createReadStream(path.join(directory, entry.filename)).pipe(createGunzip());
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readInt32LE(0);
        if (size < 5 || size > 16 * 1024 * 1024) throw new Error('Invalid BSON frame');
        if (buffer.length < size) break;
        batch.push(BSON.deserialize(buffer.subarray(0, size), { promoteBuffers: false }));
        buffer = buffer.subarray(size);
        count++;
        if (batch.length === 500) {
          await db.collection(entry.name).insertMany(batch);
          batch = [];
        }
      }
    }
    if (buffer.length) throw new Error('Truncated BSON backup');
    if (batch.length) await db.collection(entry.name).insertMany(batch);
    if (count !== entry.count) throw new Error('Restored count mismatch');
    for (const {
      key,
      name,
      unique,
      sparse,
      partialFilterExpression,
      expireAfterSeconds,
      collation
    } of entry.indexes) {
      if (name === '_id_') continue;
      await db.collection(entry.name).createIndex(key, {
        name,
        ...(unique === undefined ? {} : { unique }),
        ...(sparse === undefined ? {} : { sparse }),
        ...(partialFilterExpression ? { partialFilterExpression } : {}),
        ...(expireAfterSeconds === undefined ? {} : { expireAfterSeconds }),
        ...(collation ? { collation } : {})
      });
    }
  }
  return manifest;
}
async function compare(db, manifest) {
  const rows = [];
  for (const entry of manifest.collections) {
    const count = await db.collection(entry.name).countDocuments();
    const indexes = await db.collection(entry.name).listIndexes().toArray();
    const rawHash = createHash('sha256');
    for await (const doc of db.collection(entry.name).find({}).sort({ _id: 1 }))
      rawHash.update(BSON.serialize(doc));
    if (rawHash.digest('hex') !== entry.rawSha256) throw new Error('Restored BSON content mismatch');
    if (
      count !== entry.count ||
      JSON.stringify(indexes.map((i) => [i.name, i.key, !!i.unique]).sort()) !==
        JSON.stringify(entry.indexes.map((i) => [i.name, i.key, !!i.unique]).sort())
    )
      throw new Error('Restore collection/index mismatch');
    rows.push({ name: entry.name, count, indexes: indexes.length });
  }
  return rows;
}
module.exports = { backup, restore, compare, sha };
