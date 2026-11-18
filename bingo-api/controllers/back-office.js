const mongoose = require('mongoose');
const User = mongoose.model('Users');
const { audit } = require('../pilot/commands');
const failure = require('../pilot/errors');

async function mutation(req, action, work) {
  const session = await mongoose.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const result = await work(session);
      response = result.data;
      if (result.resourceId) await audit(session, { actorId: req.staff.id, action, resourceId: result.resourceId });
    }, { writeConcern: { w: 'majority' } });
    return response;
  } finally { await session.endSession(); }
}
module.exports.getPlayersData = async function (req, res) {
  const rows = await User.find().select('_id email name balance wins');
  await audit(null, { actorId: req.staff.id, action: 'legacy.players_viewed', resourceId: req.staff.id });
  res.json(rows);
};
module.exports.createPlayer = async function (req, res) {
  const data = req.body.objPlayerData;
  if (!data || !data.email || !data.name || !data.password) throw failure(400, 'Player name, email and password are required');
  res.json(await mutation(req, 'legacy.player_created', async session => {
    if (await User.countDocuments({ email: data.email }).session(session)) return { data: { isExisted: true } };
    const user = new User({ name: data.name, email: data.email, balance: data.balance, wins: data.wins });
    user.setPassword(data.password);
    await user.save({ session });
    return { resourceId: user._id, data: { token: user.generateJwt() } };
  }));
};
module.exports.deletePlayer = async function (req, res) {
  if (!req.body.email) throw failure(400, 'Email is required');
  res.json(await mutation(req, 'legacy.player_deleted', async session => {
    const user = await User.findOneAndDelete({ email: req.body.email }, { session });
    return { resourceId: user && user._id, data: { acknowledged: true, deletedCount: user ? 1 : 0, ok: 1 } };
  }));
};
module.exports.updatePlayerData = async function (req, res) {
  const data = req.body.objPlayerData;
  if (!data || !data.email) throw failure(400, 'Email is required');
  res.json(await mutation(req, 'legacy.player_updated', async session => {
    const user = await User.findOne({ email: data.email }).session(session);
    if (!user) throw failure(404, 'Player not found');
    user.name = data.name;
    user.setBalance(data.balance);
    user.setWins(data.wins);
    if (data.password) user.setPassword(data.password);
    await user.save({ session });
    return { resourceId: user._id, data: { email: user.email, name: user.name, balance: user.balance, wins: user.wins } };
  }));
};
