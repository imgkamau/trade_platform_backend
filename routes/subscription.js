const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Create a Stripe checkout session
router.post('/create-checkout-session', auth, async (req, res) => {
  try {
    const { userType, priceId } = req.body;
    const { userId } = req.user;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId, // You'll need to create these price IDs in Stripe dashboard
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `com.keeutrade.neta://subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `com.keeutrade.neta://subscription/cancel`,
      customer_email: req.user.email,
      metadata: {
        userId,
        userType
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe session creation error:', error);
    res.status(500).json({ message: 'Failed to create checkout session' });
  }
});

// Webhook to handle successful subscriptions
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Add subscription to database
    await connection.execute({
      sqlText: `
        INSERT INTO TRADE.GWTRADE.USER_SUBSCRIPTIONS (
          USER_ID, 
          SUBSCRIPTION_TYPE,
          START_DATE,
          END_DATE,
          STATUS,
          STRIPE_SUBSCRIPTION_ID
        ) VALUES (?, ?, CURRENT_TIMESTAMP(), DATEADD(month, 1, CURRENT_TIMESTAMP()), 'active', ?)
      `,
      binds: [
        session.metadata.userId,
        session.metadata.userType,
        session.subscription
      ],
    });
  }

  res.json({ received: true });
});

// Keep existing trial subscription endpoint
router.post('/start-trial', auth, async (req, res) => {
  try {
    const { userId } = req.user;
    const { subscriptionType } = req.body;

    const subscription = await connection.execute({
      sqlText: `
        INSERT INTO TRADE.GWTRADE.USER_SUBSCRIPTIONS (
          USER_ID, 
          SUBSCRIPTION_TYPE,
          START_DATE,
          END_DATE,
          STATUS
        ) VALUES (?, ?, CURRENT_TIMESTAMP(), DATEADD(day, 7, CURRENT_TIMESTAMP()), 'trial')
      `,
      binds: [userId, subscriptionType],
    });

    res.json({ message: 'Trial subscription activated' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to activate trial' });
  }
});

// Keep existing status endpoint
router.get('/status', auth, async (req, res) => {
  try {
    const { userId } = req.user;

    const subscription = await connection.execute({
      sqlText: `
        SELECT * FROM TRADE.GWTRADE.USER_SUBSCRIPTIONS 
        WHERE USER_ID = ? 
        AND END_DATE > CURRENT_TIMESTAMP()
        AND STATUS IN ('active', 'trial')
      `,
      binds: [userId],
    });

    res.json(subscription);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch subscription status' });
  }
});

router.post('/create-trial-session', auth, async (req, res) => {
  try {
    const { userType, priceId } = req.body;
    const { userId } = req.user;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_period_days: 7,
      },
      success_url: `com.keeutrade.neta://subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `com.keeutrade.neta://subscription/cancel`,
      customer_email: req.user.email,
      metadata: {
        userId,
        userType
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe trial session creation error:', error);
    res.status(500).json({ message: 'Failed to create trial session' });
  }
}); 