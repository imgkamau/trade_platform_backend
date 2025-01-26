// middleware/auth.js

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Export the function directly instead of an object
module.exports = {
  // Make verifyToken return the middleware function
  verifyToken: (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ message: 'No token provided' });
      }

      const token = authHeader.split(' ')[1];
      
      // Determine which secret to use based on token type
      let decoded;
      try {
        // First try with JWT_SECRET (for access tokens)
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        // If that fails, try with JWT_REFRESH_SECRET (for refresh tokens)
        try {
          decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
        } catch (refreshErr) {
          throw new Error('Invalid token');
        }
      }
      
      // Add user info to request
      req.user = {
        id: decoded.id,
        role: decoded.role
      };
      
      next();
    } catch (error) {
      logger.error('Token verification error:', error);
      return res.status(401).json({ message: 'Token is not valid' });
    }
  },

  verifyRole: (roles) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ message: 'User not authenticated' });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      next();
    };
  }
};