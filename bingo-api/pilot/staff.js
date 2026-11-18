const mongoose = require('mongoose');
const { audit } = require('./commands');
const { roles: rolePermissions } = require('./permissions');
const failure = require('./errors');

// Local operator provisioning only. No HTTP endpoint can invoke this service.
async function provision({ email, name, password, roles, active = true }) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof name !== 'string' || !name.trim() || !Array.isArray(roles) || !roles.length ||
      roles.some(role => !Object.hasOwn(rolePermissions, role)) || typeof active !== 'boolean' ||
      typeof password !== 'string' || password.length < 12) throw failure(400, 'Valid contacts, roles and a password of at least 12 characters are required');
  const Admin = mongoose.model('Admins');
  const session = await mongoose.startSession();
  let id;
  try {
    await session.withTransaction(async () => {
      let account = await Admin.findOne({ email }).session(session);
      const existing = Boolean(account);
      if (!account) account = new Admin({ email });
      account.name = name;
      account.roles = [...new Set(roles)];
      account.active = active;
      account.tokenVersion += 1;
      account.setPassword(password);
      await account.save({ session });
      await audit(session, { actorKind: 'bootstrap', action: existing ? 'staff.reprovisioned' : 'staff.created',
        resourceId: account._id, changedFields: ['roles', 'active', 'credentials'] });
      id = account.id;
    }, { writeConcern: { w: 'majority' } });
    return { id };
  } finally { await session.endSession(); }
}
module.exports = { provision };
