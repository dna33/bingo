const mongoose = require('mongoose');
require('./users');
require('./admins');
const pilot = require('../pilot/models');
const providerReceipts = require('../pilot/providers/provider-receipts');

async function connect(uri) {
  if (!uri) throw new Error('DB_URI is required');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    await mongoose.disconnect();
    throw new Error('Pilot persistence requires a MongoDB replica set or mongos');
  }
  // Fail startup if uniqueness constraints cannot be installed. No silent index failures.
  await Promise.all(
    [mongoose.model('Users'), mongoose.model('Admins'), ...Object.values(pilot), ...Object.values(providerReceipts)].map(
      (model) => model.init()
    )
  );
  await require('../operations').verifyUniqueIndexes(mongoose.connection.db);
}
module.exports = { connect, disconnect: () => mongoose.disconnect() };
