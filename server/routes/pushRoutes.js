const express = require('express');
const pushController = require('../controllers/pushController');
const { verifyToken } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(verifyToken);
router.get('/config', pushController.getConfig);
router.get('/status', pushController.getStatus);
router.put('/subscription', pushController.subscribe);
router.delete('/subscription', pushController.unsubscribe);
router.put('/preferences', pushController.updatePreferences);
// Authenticated plumbing check for the account's own devices, never the reply
// pipeline. No endpoint-specific rate limit:
// the site-wide /api limiter still applies as the backstop.
router.post('/test', pushController.sendTest);

module.exports = router;
