const cron = require('node-cron');

cron.schedule('0 0 * * *', async () => {
  try {
    await connection.execute({
      sqlText: `
        UPDATE TRADE.GWTRADE.USER_SUBSCRIPTIONS 
        SET STATUS = 'expired' 
        WHERE END_DATE < CURRENT_TIMESTAMP() 
        AND STATUS IN ('active', 'trial')
      `
    });
  } catch (error) {
    console.error('Subscription cleanup job failed:', error);
  }
}); 