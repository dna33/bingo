const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
if (process.env.NODE_ENV !== 'test') require('dotenv').config();

const adminSchema = new mongoose.Schema({
  email: {
    type: String,
    unique: true,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  hash: String,
  salt: String,
  roles: [{ type: String, enum: Object.keys(require('../pilot/permissions').roles) }],
  active: { type: Boolean, default: false },
  tokenVersion: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger }
});

adminSchema.methods.setPassword = function(password) {
	this.salt = crypto.randomBytes(16).toString('hex');
	this.hash = 'scrypt:' + crypto.scryptSync(password, this.salt, 64).toString('hex');
};

adminSchema.methods.validPassword = function(password) {
  const modern = this.hash && this.hash.startsWith('scrypt:');
  const expected = modern ? this.hash.slice(7) : this.hash;
  if (!expected || !this.salt) return false;
  const actual = modern ? crypto.scryptSync(password, this.salt, 64) :
    crypto.pbkdf2Sync(password, this.salt, 1000, 64, 'sha512');
  const stored = Buffer.from(expected, 'hex');
  return stored.length === actual.length && crypto.timingSafeEqual(stored, actual);
};

adminSchema.methods.generateJwt = function() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);

	return jwt.sign({
		_id: this._id,
    kind: 'staff',
    tokenVersion: this.tokenVersion,
		email: this.email,
		name: this.name,
		exp: parseInt(expiry.getTime() / 1000)
	}, process.env.DB_SECRET, { issuer: 'bingo', audience: 'bingo-staff' });
};

mongoose.model('Admins', adminSchema);
