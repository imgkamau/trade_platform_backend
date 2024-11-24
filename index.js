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
const authMiddleware = require('./middleware/auth');
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
//const { connectToSnowflake } = require('./db'); // Import connectToSnowflake
// Conditionally import connectToSnowflake
let connectToSnowflake;
if (env !== 'production') {
  ({ connectToSnowflake } = require('./db'));
}
const verifyCompanyRouter = require('./routes/verifyCompany');

const app = express();

// **1. Set Trust Proxy**
app.set('trust proxy', 1); // Trust the first proxy (Vercel)

// **2. CORS Configuration**
const corsOptions = {
  origin:
    env === 'production'
      ? process.env.FRONTEND_URL || 'https://ke-eutrade.org'
      : process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Allow cookies and other credentials
  optionsSuccessStatus: 204, // Some legacy browsers choke on 204
};

// Apply CORS Middleware
app.use(cors(corsOptions));

// **3. Handle Preflight OPTIONS Requests**
app.options('*', cors(corsOptions));

// **4. JSON Parsing Middleware**
app.use(express.json());

// **5. Security Middleware**
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
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/checklists', checklistsRouter);
app.use('/api/quotes', quotesRoutes);
app.use('/api/regulations', regulationsRouter);
app.use('/api/logistics', logisticsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/shipping', shippingRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/messages', messagesRouter); // Messages Router
app.use('/api/analytics', analyticsRouter);
app.use('/api/inquiries', inquiriesRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/seller-products', sellerProductsRouter);
app.use('/api', verifyCompanyRouter);

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

// **13. Export as Serverless Function and Start Server Locally**
if (env !== 'production') {
  // **14. Start the Server Locally**
  const PORT = process.env.PORT || 5000;

  // Use an async IIFE to handle async operations at the top level
  (async () => {
    try {
      // Establish database connection
      await connectToSnowflake();
      logger.info('Database connection established.');

      // Start the server
      app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server running on port ${PORT}`);
      });

      // Start the scheduler after successful DB connection
      scheduler();
    } catch (error) {
      logger.error(`Failed to connect to database: ${error.message}`);
      process.exit(1); // Exit the application with an error code
    }
  })();
} else {
  // **Production Initialization**
  (async () => {
    try {
      // Establish database connection
      await connectToSnowflake();
      logger.info('Database connection established.');
      // **Do not** start the server or the scheduler in production
    } catch (error) {
      logger.error(`Failed to connect to database: ${error.message}`);
      // **Note:** Avoid exiting the process in serverless environments
    }
  })();
}

// **15. Export Handler for Serverless Deployment**
module.exports = app;
