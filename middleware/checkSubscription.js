const checkSubscription = async (req, res, next) => {
  try {
    const { userId } = req.user;
    
    const subscription = await connection.execute({
      sqlText: `
        SELECT * FROM TRADE.GWTRADE.USER_SUBSCRIPTIONS 
        WHERE USER_ID = ? 
        AND END_DATE > CURRENT_TIMESTAMP()
        AND STATUS IN ('active', 'trial')
        ORDER BY END_DATE DESC
        LIMIT 1
      `,
      binds: [userId],
    });

    if (!subscription.rows?.length) {
      return res.status(402).json({ message: 'Subscription required' });
    }

    req.subscription = subscription.rows[0];
    next();
  } catch (error) {
    res.status(500).json({ message: 'Error checking subscription' });
  }
};

module.exports = checkSubscription; 