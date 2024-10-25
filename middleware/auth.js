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
    req.user = decoded.user; // Attach the user payload to the request
    console.log('User decoded from token:', JSON.stringify(req.user, null, 2)); // Pretty print for better readability
    next();
  } catch (error) {
    console.error('Token verification error:', error.name, error.message);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

module.exports = authMiddleware;