const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Create trial subscription
router.post('/create-trial-session', async (req, res) => {
  try {
    const userId = req.user.id || req.user.user?.id;
    const { trialDays = 7, userType, priceId } = req.body;

    logger.debug('Creating trial subscription for user:', userId);

    // First, check if user has any active subscription (trial or paid)
    const activeSubscriptionQuery = `
      SELECT * FROM TRADE.GWTRADE.USER_SUBSCRIPTIONS
      WHERE USER_ID = ?
      AND END_DATE > CURRENT_TIMESTAMP()
      AND STATUS IN ('active', 'trial', 'pending_trial')`;

    const activeSubscriptions = await db.execute({
      sqlText: activeSubscriptionQuery,
      binds: [userId]
    });

    // Add detailed logging
    logger.debug('Active subscriptions found:', JSON.stringify(activeSubscriptions));

    // Let's also check what's in the database directly
    const allSubscriptionsQuery = `
      SELECT * FROM TRADE.GWTRADE.USER_SUBSCRIPTIONS
      WHERE USER_ID = ?`;

    const allSubscriptions = await db.execute({
      sqlText: allSubscriptionsQuery,
      binds: [userId]
    });

    logger.debug('All subscriptions for user:', JSON.stringify(allSubscriptions));

    if (activeSubscriptions && activeSubscriptions.length > 0) {
      logger.debug('Active subscription details:', JSON.stringify(activeSubscriptions[0]));
      return res.status(400).json({
        code: 'ACTIVE_SUBSCRIPTION_EXISTS',
        message: 'User already has an active subscription',
        subscription: activeSubscriptions[0] // Include subscription details in response
      });
    }

    // Check if user has ever had a trial before
    const trialHistoryQuery = `
      SELECT * FROM TRADE.GWTRADE.USER_SUBSCRIPTIONS
      WHERE USER_ID = ?
      AND STATUS = 'trial'`;

    const trialHistory = await db.execute({
      sqlText: trialHistoryQuery,
      binds: [userId]
    });

    if (trialHistory && trialHistory.length > 0) {
      logger.debug('User has previously used a trial');
      return res.status(400).json({
        code: 'TRIAL_ALREADY_USED',
        message: 'Trial period has already been used'
      });
    }

    // Create Stripe checkout session with trial period
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      subscription_data: {
        trial_period_days: trialDays,
      },
      success_url: `https://ke-eutrade.org/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://ke-eutrade.org/subscription/cancel`,
      customer_email: req.user.email,
      metadata: {
        userId,
        userType
      }
    });

    // Create pending trial subscription record
    await db.execute({
      sqlText: `
        INSERT INTO TRADE.GWTRADE.USER_SUBSCRIPTIONS
        (USER_ID, STATUS, STRIPE_SESSION_ID, USER_TYPE, START_DATE, END_DATE)
        VALUES (?, 'pending_trial', ?, ?, CURRENT_TIMESTAMP(), DATEADD(day, ?, CURRENT_TIMESTAMP()))`,
      binds: [userId, session.id, userType, trialDays]
    });

    res.json({
      url: session.url,
      sessionId: session.id
    });

  } catch (error) {
    logger.error('Error creating trial session:', error);
    res.status(500).json({
      message: 'Failed to create trial session',
      error: error.message
    });
  }
});

// Get subscription status
router.get('/status', async (req, res) => {
  try {
    const userId = req.user.id || req.user.user?.id;
    
    const subscriptions = await db.execute({
      sqlText: `
        SELECT * FROM TRADE.GWTRADE.USER_SUBSCRIPTIONS 
        WHERE USER_ID = ? 
        AND END_DATE > CURRENT_TIMESTAMP()
        AND STATUS IN ('active', 'trial')
        ORDER BY END_DATE DESC
        LIMIT 1
      `,
      binds: [userId]
    });

    if (!subscriptions || subscriptions.length === 0) {
      return res.json({
        hasSubscription: false,
        status: 'none'
      });
    }

    res.json({
      hasSubscription: true,
      subscription: subscriptions[0]
    });
  } catch (error) {
    logger.error('Error checking subscription status:', error);
    res.status(500).json({ 
      message: 'Failed to check subscription status',
      error: error.message 
    });
  }
});

// Create checkout session for subscription
router.post('/create-checkout-session', async (req, res) => {
  try {
    const userId = req.user.id || req.user.user?.id;
    const { userType, priceId } = req.body;

    // Get user details for the checkout session
    const userQuery = `
      SELECT * FROM TRADE.GWTRADE.USERS 
      WHERE USER_ID = ?`;

    const userResult = await db.execute({
      sqlText: userQuery,
      binds: [userId]
    });

    if (!userResult || userResult.length === 0) {
      return res.status(404).json({
        code: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    const user = userResult[0];

    // Get subscription price details
    const priceDetails = await db.execute({
      sqlText: `
        SELECT * FROM TRADE.GWTRADE.SUBSCRIPTION_PRICES
        WHERE PRICE_ID = ? AND USER_TYPE = ?`,
      binds: [priceId, userType]
    });

    if (!priceDetails || priceDetails.length === 0) {
      return res.status(404).json({
        code: 'PRICE_NOT_FOUND',
        message: 'Subscription price not found'
      });
    }

    const price = priceDetails[0];

    // Create Stripe customer if not exists
    let stripeCustomer;
    if (user.STRIPE_CUSTOMER_ID) {
      stripeCustomer = await stripe.customers.retrieve(user.STRIPE_CUSTOMER_ID);
    } else {
      stripeCustomer = await stripe.customers.create({
        email: user.EMAIL,
        metadata: {
          userId: userId,
          userType: userType
        }
      });

      // Update user with Stripe customer ID
      await db.execute({
        sqlText: `
          UPDATE TRADE.GWTRADE.USERS 
          SET STRIPE_CUSTOMER_ID = ? 
          WHERE USER_ID = ?`,
        binds: [stripeCustomer.id, userId]
      });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomer.id,
      payment_method_types: ['card'],
      line_items: [{
        price: price.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}&token=${req.headers.authorization}`,
      cancel_url: `${process.env.FRONTEND_URL}/subscription/cancel`,
      metadata: {
        userId: userId,
        userType: userType,
        priceId: priceId
      }
    });

    // Create pending subscription record
    await db.execute({
      sqlText: `
        INSERT INTO TRADE.GWTRADE.USER_SUBSCRIPTIONS
        (USER_ID, STATUS, STRIPE_SESSION_ID, PRICE_ID, USER_TYPE)
        VALUES (?, 'pending', ?, ?, ?)`,
      binds: [userId, session.id, priceId, userType]
    });

    // Log the checkout session creation
    logger.info('Checkout session created for user:', {
      userId,
      sessionId: session.id,
      priceId,
      userType
    });

    res.json({
      url: session.url,
      sessionId: session.id
    });

  } catch (error) {
    logger.error('Error creating checkout session:', error);
    res.status(500).json({
      message: 'Failed to create checkout session',
      error: error.message
    });
  }
});

// Add webhook handler for Stripe events
router.post(
  '/webhook', 
  express.raw({type: 'application/json'}), 
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    
    try {
      logger.debug('Received webhook:', {
        signature: !!sig,
        secret: !!process.env.STRIPE_WEBHOOK_SECRET
      });

      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      logger.info('Webhook event verified:', event.type);

      // Handle the webhook event
      switch (event.type) {
        case 'checkout.session.completed':
          const session = event.data.object;
          await db.execute({
            sqlText: `
              UPDATE TRADE.GWTRADE.USER_SUBSCRIPTIONS
              SET STATUS = 'active',
                  START_DATE = CURRENT_TIMESTAMP(),
                  END_DATE = CASE 
                    WHEN STATUS = 'pending_trial' THEN DATEADD(day, 7, CURRENT_TIMESTAMP())
                    ELSE DATEADD(month, 1, CURRENT_TIMESTAMP())
                  END
              WHERE STRIPE_SESSION_ID = ?`,
            binds: [session.id]
          });
          break;
      }

      res.json({received: true});
    } catch (err) {
      logger.error('Webhook error:', err);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// Add this new route
router.get('/debug-status', async (req, res) => {
  try {
    const userId = req.user.id || req.user.user?.id;
    
    const allSubscriptions = await db.execute({
      sqlText: `
        SELECT * FROM TRADE.GWTRADE.USER_SUBSCRIPTIONS 
        WHERE USER_ID = ?
        ORDER BY CREATED_AT DESC
      `,
      binds: [userId]
    });

    res.json({
      userId,
      subscriptions: allSubscriptions,
      currentTime: new Date(),
      timeZone: 'UTC'
    });
  } catch (error) {
    logger.error('Error in debug-status:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/verify', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.id;
    const userType = req.user.role;

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      await db.execute({
        sqlText: `
          INSERT INTO TRADE.GWTRADE.USER_SUBSCRIPTIONS
          (USER_ID, STRIPE_SUBSCRIPTION_ID, STATUS, TRIAL_END)
          VALUES (?, ?, ?, ?)`,
        binds: [
          userId,
          session.subscription,
          'active',
          new Date(Date.now() + (7 * 24 * 60 * 60 * 1000))
        ]
      });

      return res.json({ 
        success: true,
        userType 
      });
    }

    res.status(400).json({ success: false });
  } catch (error) {
    logger.error('Error verifying subscription:', error);
    res.status(500).json({ success: false });
  }
});

// Add new route for session recovery
router.get('/recover-session/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (session.payment_status === 'paid') {
      // Update subscription status
      await db.execute({
        sqlText: `
          UPDATE TRADE.GWTRADE.USER_SUBSCRIPTIONS
          SET STATUS = 'active'
          WHERE STRIPE_SESSION_ID = ?`,
        binds: [session.id]
      });
    }
    res.json({ status: session.payment_status });
  } catch (error) {
    logger.error('Session recovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;