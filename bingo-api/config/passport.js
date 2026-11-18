const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const mongoose = require('mongoose');

function strategy(modelName) {
  return new LocalStrategy({ usernameField: 'email' }, (username, password, done) => {
    mongoose.model(modelName).findOne({ email: username }).then(record => {
      if (!record || (modelName === 'Admins' && (!record.active || !record.roles.length)) || !record.validPassword(password)) {
        return done(null, false, { message: 'Invalid credentials' });
      }
      done(null, record);
    }).catch(done);
  });
}
passport.use('userLogin', strategy('Users'));
passport.use('adminLogin', strategy('Admins'));
