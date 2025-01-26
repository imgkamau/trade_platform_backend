// index.js
// Load environment variables from the appropriate .env file
const dotenv = require('dotenv');
const env = process.env.NODE_ENV || 'development';
if (env !== 'production') {
  dotenv.config({ path: `.env.${env}` });
}
const express = require('express');
const helmet = require('helmet'); // For setting various HTTP headers for security
const rateLimit = require('express-rate-limit'); // Import express-rate-limit
const morgan = require('morgan');
const cors = require('cors');
const serverless = require('serverless-http'); // To wrap Express for serverless
const logger = require('./utils/logger');
const refreshTokenRoute = require('./routes/refreshToken');
const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const errorHandler = require('./middleware/errorHandler');
const regulationsRouter = require('./routes/regulations');
const logisticsRouter = require('./routes/logistics');
const documentsRouter = require('./routes/documents');
const shippingRouter = require('./routes/shipping');
const checklistsRouter = require('./routes/checklists');
const quotesRoutes = require('./routes/quotes');
const analyticsRouter = require('./routes/analytics');
const messagesRouter = require('./routes/messages'); // Messages Router
const inquiriesRouter = require('./routes/inquiries'); // Inquiries Router
const contactsRouter = require('./routes/contacts'); // Contacts Router
const scheduler = require('./utils/scheduler'); // Import the scheduler
const sellerProductsRouter = require('./routes/sellerProducts');
const buyersRouter = require('./routes/buyers');
const matchmakingRoutes = require('./routes/matchmaking');
const euRequirementsRouter = require('./routes/eu-requirements');
const chatRouter = require('./routes/chat');
const sellersRouter = require('./routes/sellers');
const jwt = require('jsonwebtoken');  // Add this at the top with other imports
const checkSubscription = require('./middleware/checkSubscription');
const subscriptionRouter = require('./routes/subscription');
const webhookRouter = require('./routes/webhook');
const cleanupExpiredTokens = require('./jobs/tokenCleanup');
const { verifyToken } = require('./middleware/auth');

//const { connectToSnowflake } = require('./db'); // Import connectToSnowflake
// Conditionally import connectToSnowflake
let connectToSnowflake;
if (env !== 'production') {
  ({ connectToSnowflake } = require('./db'));
}
const verifyCompanyRouter = require('./routes/verifyCompany');
const activitiesRouter = require('./routes/activities');
const testRouter = require('./routes/test');
const { setupWebSocket } = require('./services/socket');

const app = express();
const PORT = process.env.PORT || 5000;
const server = require('http').createServer(app);

// **1. Set Trust Proxy**
app.set('trust proxy', 1);

// **2. CORS Configuration**
const corsOptions = {
  origin:
    env === 'production'
      ? process.env.FRONTEND_URL || 'https://ke-eutrade.org'
      : process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Add webhook route BEFORE express.json()
app.use('/api/subscription/webhook', webhookRouter);

// Then add json parsing and other middleware
app.use(express.json());
app.use(helmet());

// **6. Logging Middleware**
app.use(
  morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// **7. Rate Limiting for Auth Routes**
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to specific auth routes
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

// **8. Mount Routers**
// Public routes (no subscription check)
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api', verifyCompanyRouter);
app.use('/api', matchmakingRoutes);
app.use('/test', testRouter);
app.use('/api', euRequirementsRouter);
app.use('/api', sellersRouter);
// Protected routes (with auth and subscription check)
app.use('/api/checklists', verifyToken, checkSubscription, checklistsRouter);
app.use('/api/quotes', verifyToken, checkSubscription, quotesRoutes);
app.use('/api/regulations', verifyToken, checkSubscription, regulationsRouter);
app.use('/api/logistics', verifyToken, checkSubscription, logisticsRouter);
app.use('/api/documents', verifyToken, checkSubscription, documentsRouter);
app.use('/api/shipping', verifyToken, checkSubscription, shippingRouter);
app.use('/api/orders', verifyToken, checkSubscription, ordersRouter);
app.use('/api/messages', verifyToken, checkSubscription, messagesRouter);
app.use('/api/analytics', verifyToken, checkSubscription, analyticsRouter);
app.use('/api/inquiries', verifyToken, checkSubscription, inquiriesRouter);
app.use('/api/contacts', verifyToken, checkSubscription, contactsRouter);
app.use('/api/seller-products', verifyToken, checkSubscription, sellerProductsRouter);
app.use('/api/activities', verifyToken, checkSubscription, activitiesRouter);
app.use('/api/buyers', verifyToken, checkSubscription, buyersRouter);
app.use('/api/chat', verifyToken, checkSubscription, chatRouter);
app.use('/api/subscription', verifyToken, subscriptionRouter);

// Add this near your other route definitions
app.post('/api/internal/cleanup-tokens', async (req, res) => {
  // Verify this is an internal request from Vercel cron
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await cleanupExpiredTokens();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// **9. Root Route**
app.get('/', (req, res) => {
  res.send('Welcome to the Products API');
});

// **10. Health Check Route**
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// **11. Catch-all Route for Undefined Routes**
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// **12. Error Handling Middleware (Should be after all other routes)**
app.use(errorHandler);

// For Vercel, we need to export a handler function
if (process.env.NODE_ENV === 'production') {
  // Export the serverless handler
  module.exports = async (req, res) => {
    // Initialize database connection if needed
    try {
      await connectToSnowflake();
      logger.info('Database connection established.');
    } catch (error) {
      logger.error(`Failed to connect to database: ${error.message}`);
    }
    
    // Handle the request using the Express app
    return app(req, res);
  };
} else {
  // Development mode
  const PORT = process.env.PORT || 5000;
  
  (async () => {
    try {
      await connectToSnowflake();
      logger.info('Database connection established.');
      
      app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server running on port ${PORT}`);
      });
      
      scheduler();
    } catch (error) {
      logger.error(`Failed to connect to database: ${error.message}`);
      process.exit(1);
    }
  })();
  
  // Export the app for testing
  module.exports = app;
}
