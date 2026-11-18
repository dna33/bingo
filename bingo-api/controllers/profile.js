const User = require('mongoose').model('Users');

module.exports.profileRead = async function (req, res) {
  const user = await User.findById(req.payload._id).select('-hash -salt');
  if (!user) return res.status(404).json({ message: 'Player not found' });
  res.json(user);
};
module.exports.setNewBalance = async function (req, res) {
  const user = await User.findOne({ _id: req.payload._id, email: req.body.email });
  if (!user) return res.status(404).json({ message: 'Player not found' });
  const amount = Number(req.body.newSum);
  if (!Number.isFinite(amount)) return res.status(400).json({ message: 'Invalid amount' });
  user.setBalance(user.balance + (req.body.spending ? -amount : amount));
  await user.save();
  res.json({ email: user.email, balance: user.balance, wins: user.wins });
};
module.exports.setWins = async function (req, res) {
  const user = await User.findOne({ _id: req.payload._id, email: req.body.email });
  if (!user) return res.status(404).json({ message: 'Player not found' });
  const wins = Number(req.body.wins);
  if (!Number.isFinite(wins)) return res.status(400).json({ message: 'Invalid wins' });
  user.setWins(user.wins + wins);
  await user.save();
  res.json({ email: user.email, balance: user.balance, wins: user.wins });
};
