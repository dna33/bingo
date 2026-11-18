const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const failure = require('./errors');
const { permissionsFor } = require('./permissions');

function tokenFrom(req, audience) {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) throw failure(401, 'Authentication required');
  try {
    return jwt.verify(header.slice(7), process.env.DB_SECRET, {
      algorithms: ['HS256'], issuer: 'bingo', audience
    });
  } catch (_) { throw failure(401, 'Invalid or expired credentials'); }
}
async function staff(req, res, next) {
  try {
    const payload = tokenFrom(req, 'bingo-staff');
    if (payload.kind !== 'staff' || !mongoose.isValidObjectId(payload._id)) throw failure(401, 'Invalid credentials');
    const account = await mongoose.model('Admins').findById(payload._id).select('roles active tokenVersion');
    if (!account || !account.active || account.tokenVersion !== payload.tokenVersion) throw failure(401, 'Credentials revoked');
    req.staff = { id: account.id, permissions: permissionsFor(account) };
    next();
  } catch (error) { next(error); }
}
function permit(permission) {
  return (req, res, next) => req.staff.permissions.has(permission) ? next() : next(failure(403, 'Insufficient permission'));
}
async function player(req, res, next) {
  try {
    req.payload = tokenFrom(req, 'bingo-player');
    if (req.payload.kind !== 'player' || !mongoose.isValidObjectId(req.payload._id) ||
        !await mongoose.model('Users').exists({ _id: req.payload._id })) throw failure(401, 'Invalid credentials');
    next();
  } catch (error) { next(error); }
}
module.exports = { staff, permit, player };
