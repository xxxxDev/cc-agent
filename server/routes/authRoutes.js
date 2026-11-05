const express = require('express');
const authController = require('../controllers/authController');
const { verifyToken, restrictTo } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/login', authController.login);
// Two-step sign-in.
router.post('/login/code', authController.loginCode);
router.post('/login/start', authController.loginStart);
router.get('/two-step', verifyToken, authController.twoStepStatus);
router.post('/two-step/setup', verifyToken, authController.twoStepSetup);
router.post('/two-step/enable', verifyToken, authController.twoStepEnable);
router.post('/two-step/disable', verifyToken, authController.twoStepDisable);
router.post('/logout', authController.logout);
router.get('/verify', authController.verifySession);
router.get('/me', verifyToken, authController.me);
router.put('/me', verifyToken, authController.updateMe);
router.post('/change-password', verifyToken, authController.changePassword);
// Passkeys.
router.post('/passkey/start', authController.passkeyStart);
router.post('/passkey/again', verifyToken, authController.passkeyAgain);
router.post('/passkey/finish', authController.passkeyFinish);
router.get('/passkeys', verifyToken, authController.listPasskeys);
router.post('/passkeys/options', verifyToken, authController.passkeyOptions);
router.post('/passkeys', verifyToken, authController.addPasskey);
router.delete('/passkeys/:id', verifyToken, authController.removePasskey);
// QR sign-in.
router.post('/qr/start', authController.qrStart);
router.get('/qr/poll', authController.qrPoll);
router.get('/qr/:id', verifyToken, authController.qrPeek);
router.post('/qr/:id/decide', verifyToken, authController.qrDecide);
router.get('/devices', verifyToken, authController.listDevices);
router.post('/devices', verifyToken, authController.bindDevice);
router.delete('/devices/:id', verifyToken, authController.removeDevice);
router.delete('/sessions/:id', verifyToken, authController.removeSession);

// admin user management
router.get('/users', verifyToken, restrictTo('admin'), authController.listUsers);
// The list's order, dragged by an admin; before /users/:id.
router.put('/users/order', verifyToken, restrictTo('admin'), authController.reorderUsers);
router.post('/users', verifyToken, restrictTo('admin'), authController.createUser);
router.put('/users/:id', verifyToken, restrictTo('admin'), authController.updateUser);
router.post('/users/:id/disable', verifyToken, restrictTo('admin'), authController.disableUser);
router.post('/users/:id/enable', verifyToken, restrictTo('admin'), authController.enableUser);
router.delete('/users/:id', verifyToken, restrictTo('admin'), authController.deleteUser);
router.delete('/users/:id/purge', verifyToken, restrictTo('admin'), authController.purgeUser);
router.post('/users/:id/reset-password', verifyToken, restrictTo('admin'), authController.resetUserPassword);
router.post('/users/:id/reset-two-step', verifyToken, restrictTo('admin'), authController.resetUserTwoStep);

module.exports = router;
