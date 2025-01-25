const db = require('../db');
const logger = require('../utils/logger');

async function cleanupExpiredTokens() {
  try {
    await db.execute({
      sqlText: `
        DELETE FROM TRADE.GWTRADE.REFRESH_TOKENS 
        WHERE EXPIRES_AT < CURRENT_TIMESTAMP()
      `
    });
    logger.info('Expired tokens cleaned up successfully');
    return { success: true };
  } catch (error) {
    logger.error('Token cleanup failed:', error);
    return { success: false, error: error.message };
  }
}

module.exports = cleanupExpiredTokens; 