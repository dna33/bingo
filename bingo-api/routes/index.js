const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/async-handler');
const { staff, permit, player } = require('../pilot/auth');
router.use('/pilot', require('../pilot/routes'));

// Back office app
const ctrlBackOffice = require('../controllers/back-office');
const ctrlAdminsAuth = require('../controllers/admins-auth');
router.get('/getPlayersData', staff, permit('legacy:manage'), asyncHandler(ctrlBackOffice.getPlayersData));
router.post('/createPlayer', staff, permit('legacy:manage'), asyncHandler(ctrlBackOffice.createPlayer));
router.post('/deletePlayer', staff, permit('legacy:manage'), asyncHandler(ctrlBackOffice.deletePlayer));
router.post('/updatePlayerData', staff, permit('legacy:manage'), asyncHandler(ctrlBackOffice.updatePlayerData));
router.post('/loginAdmin', asyncHandler(ctrlAdminsAuth.loginAdmin));
// Staff provisioning is local-only; public registration is deliberately unavailable.
router.post('/registerAdmin', (req, res) => res.status(404).json({ message: 'Not found' }));

// Main app
const ctrlProfile = require('../controllers/profile');
const ctrlAuth = require('../controllers/users-auth');
router.post('/setNewBalance', player, asyncHandler(ctrlProfile.setNewBalance));
router.get('/profile', player, asyncHandler(ctrlProfile.profileRead));
router.post('/register', asyncHandler(ctrlAuth.register));
router.post('/login', asyncHandler(ctrlAuth.login));
router.post('/setWins', player, asyncHandler(ctrlProfile.setWins));

module.exports = router;
