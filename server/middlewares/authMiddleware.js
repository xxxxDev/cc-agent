const jwt = require('jsonwebtoken');
const { resolveLivePrincipal } = require('../services/livePrincipal');
// required lazily-in-practice: authController always loads first (authRoutes
// requires it before this module), and touchActivity is only called at request
// time, so there is no circular-init hazard.
const authController = require('../controllers/authController');

function verifyToken(req, res, next) {
  let token = req.cookies.session_id || req.headers.authorization;

  // A string or nothing: cookie-parser makes an object of a cookie written as j:{…}
  // (app.js drops it too; checked here as well).
  if (!token || typeof token !== 'string') {
    return res.status(401).json({ message: 'No token provided' });
  }

  if (token.startsWith('Bearer ')) {
    token = token.split(' ')[1];
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    // Re-read both the live session and user record. JWT username/role are only
    // historical claims; authorization and snapshots always use fresh DB data.
    resolveLivePrincipal(token, decoded.id).then((principal) => {
      if (!principal) return res.status(401).json({ message: 'Invalid or expired session' });
      req.userId = principal.id;
      req.username = principal.username;
      req.displayName = principal.name;
      req.role = principal.role;
      req.principal = principal;
      req.sessionToken = token;
      authController.touchActivity(principal.id, token, res);
      return next();
    }).catch(() => res.status(401).json({ message: 'Invalid or expired session' }));
  });
}

function restrictTo(...roles) {
  return (req, res, next) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

module.exports = { verifyToken, restrictTo };

