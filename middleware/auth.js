// middleware/auth.js

const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  // Get token from header
  const authHeader = req.header('Authorization');

  if (!authHeader) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  // Expected format: "Bearer TOKEN"
  const [bearer, token] = authHeader.split(' ');

  if (bearer !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Token format is invalid' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set in the environment variables');
    return res.status(500).json({ message: 'Internal server error' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Determine payload structure
    if (decoded.user) { // Pattern A
      if (!decoded.user.id || !decoded.user.role) {
        console.error('Token payload is missing user.id or user.role');
        return res.status(401).json({ message: 'Token payload is invalid' });
      }
      req.user = decoded.user;
    } else { // Pattern B
      if (!decoded.id || !decoded.role) {
        console.error('Token payload is missing id or role');
        return res.status(401).json({ message: 'Token payload is invalid' });
      }
      req.user = { id: decoded.id, role: decoded.role };
    }

    // Optional: Sanitize logs in production
    if (process.env.NODE_ENV !== 'production') {
      console.log('User decoded from token:', JSON.stringify(req.user, null, 2));
    }
    
    next();
  } catch (error) {
    console.error('Token verification error:', error.name, error.message);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

module.exports = authMiddleware;