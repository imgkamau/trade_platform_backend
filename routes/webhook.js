const express = require('express');
const webhookRouter = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const logger = require('../utils/logger');

webhookRouter.post('/', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    logger.info('Webhook event received:', event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        
        const subscription = await db.execute({
          sqlText: `
            SELECT USER_TYPE FROM TRADE.GWTRADE.USER_SUBSCRIPTIONS 
            WHERE STRIPE_SESSION_ID = ?`,
          binds: [session.id]
        });

        if (subscription[0]?.USER_TYPE === 'trial') {
          await db.execute({
            sqlText: `
              UPDATE TRADE.GWTRADE.USER_SUBSCRIPTIONS
              SET STATUS = 'trial',
                  START_DATE = CURRENT_TIMESTAMP(),
                  END_DATE = DATEADD(day, 7, CURRENT_TIMESTAMP())
              WHERE STRIPE_SESSION_ID = ?`,
            binds: [session.id]
          });
        } else {
          await db.execute({
            sqlText: `
              UPDATE TRADE.GWTRADE.USER_SUBSCRIPTIONS
              SET STATUS = 'active',
                  START_DATE = CURRENT_TIMESTAMP(),
                  END_DATE = DATEADD(month, 1, CURRENT_TIMESTAMP())
              WHERE STRIPE_SESSION_ID = ?`,
            binds: [session.id]
          });
        }
        break;
    }

    res.json({received: true});
  } catch (err) {
    logger.error('Webhook error:', err);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

module.exports = webhookRouter; 