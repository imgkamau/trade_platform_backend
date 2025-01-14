const { execute } = require('../db');
const logger = require('../utils/logger');

const checkSubscription = async (req, res, next) => {
  try {
    // Check if user exists in request
    if (!req.user) {
      logger.debug('No user found in request');
      return res.status(401).json({ 
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const userId = req.user.id || req.user.user?.id; // Handle both formats
    logger.debug('Checking subscription for user:', userId);

    const subscriptions = await execute({
      sqlText: `
        SELECT * 
        FROM TRADE.GWTRADE.USER_SUBSCRIPTIONS 
        WHERE USER_ID = ?
        AND END_DATE > CURRENT_TIMESTAMP()
        AND STATUS IN ('active', 'trial')
        LIMIT 1
      `,
      binds: [userId]
    });

    logger.debug('Subscription check result:', subscriptions);

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(402).json({
        message: 'Subscription required',
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }

    next();
  } catch (error) {
    logger.error('Subscription check error:', error);
    res.status(500).json({ message: 'Server error during subscription check' });
  }
};

module.exports = checkSubscription; 