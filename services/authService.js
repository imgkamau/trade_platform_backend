const jwt = require('jsonwebtoken');

const generateTokens = (user) => {
  // Access token - short lived (15 minutes)
  const accessToken = jwt.sign(
    { 
      id: user.USER_ID,
      role: user.USER_TYPE || user.ROLE  // Add fallback for role
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  // Refresh token - long lived (30 days)
  const refreshToken = jwt.sign(
    { 
      id: user.USER_ID,
      role: user.USER_TYPE || user.ROLE  // Add role to refresh token too
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' }
  );

  return { accessToken, refreshToken };
};

const verifyRefreshToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    return decoded;
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};

module.exports = {
  generateTokens
}; 