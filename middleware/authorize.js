// middleware/authorize.js

const logger = require('../utils/logger');

const authorize = (roles = []) => {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      logger.warn('User information missing from request.');
      return res.status(401).json({ message: 'Unauthorized: No user information found' });
    }

    if (roles.length && !roles.includes(req.user.role)) {
      logger.warn(`User with role ${req.user.role} attempted to access a forbidden route.`);
      return res.status(403).json({ message: 'Forbidden: Access is denied' });
    }

    next();
  };
};

module.exports = authorize;
