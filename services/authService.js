const jwt = require('jsonwebtoken');

const generateTokens = (user, rememberMe = false) => {
  // Access token - short lived (15 minutes)
  const accessToken = jwt.sign(
    { id: user.USER_ID, role: user.ROLE },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Refresh token - expiry based on rememberMe
  const refreshToken = jwt.sign(
    { id: user.USER_ID, role: user.ROLE, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: rememberMe ? '30d' : '24h' }  // 30 days if rememberMe, 24h if not
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
  generateTokens,
  verifyRefreshToken  // Export this function too
}; 