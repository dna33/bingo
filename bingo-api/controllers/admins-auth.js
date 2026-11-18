const passport = require('passport');
const { audit } = require('../pilot/commands');

module.exports.loginAdmin = function (req, res, next) {
  passport.authenticate('adminLogin', (err, record, info) => {
    if (err) return next(err);
    if (!record) return res.status(401).json(info);
    audit(null, { actorId: record._id, action: 'staff.logged_in', resourceId: record._id })
      .then(() => res.json({ token: record.generateJwt() })).catch(next);
  })(req, res, next);
};
