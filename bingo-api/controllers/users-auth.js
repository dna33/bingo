const passport = require('passport');
const Model = require('mongoose').model('Users');

module.exports.register = async function (req, res) {
  if (!req.body.email || !req.body.name || !req.body.password) {
    return res.status(400).json({ message: 'Name, email and password are required' });
  }
  if (await Model.countDocuments({ email: req.body.email })) {
    return res.json({ isExisted: true });
  }
  const user = new Model({ name: req.body.name, email: req.body.email });
  user.setBalance(50);
  user.setWins(0);
  user.setPassword(req.body.password);
  await user.save();
  res.json({ token: user.generateJwt() });
};

module.exports.login = function (req, res, next) {
  passport.authenticate('userLogin', (err, record, info) => {
    if (err) return next(err);
    if (!record) return res.status(401).json(info);
    res.json({ token: record.generateJwt() });
  })(req, res, next);
};
