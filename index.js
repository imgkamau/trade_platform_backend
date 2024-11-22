// index.js

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
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
const helmet = require('helmet'); // For setting various HTTP headers for security
const { connectToSnowflake } = require('./db'); // Import connectToSnowflake
const rateLimit = require('express-rate-limit'); // Import express-rate-limit

// Load environment variables from .env file
dotenv.config();

const app = express();

// CORS configuration
const corsOptions = {
  origin:
    process.env.NODE_ENV === 'production'
      ? process.env.FRONTEND_URL || 'https://ke-eutrade.org'
      : process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json());

// Security Middleware
app.use(helmet());

// Setup Morgan to use Winston's stream
app.use(
  morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// Define rate limit rules for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to auth routes
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

// Refresh Token Route (assumed public)
app.use(refreshTokenRoute);

// Public Routes
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
// Use the seller-products router
app.use('/api/seller-products', sellerProductsRouter);

// Root Route
app.get('/', (req, res) => {
  res.send('Welcome to the Products API');
});

// Health Check Route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Catch-all route for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error Handling Middleware (Should be after all other routes)
app.use(errorHandler);

// Start the server after establishing database connection
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

// For testing purposes
module.exports = app;
