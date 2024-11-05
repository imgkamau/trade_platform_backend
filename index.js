// trade-platform-backend/index.js

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const refreshTokenRoute = require('./routes/refreshToken');
const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const messagesRouter = require('./routes/messages');
const ordersRouter = require('./routes/orders');
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const regulationsRouter = require('./routes/regulations');
const logisticsRouter = require('./routes/logistics');
const documentsRouter = require('./routes/documents');
const shippingRouter = require('./routes/shipping');
const checklistsRouter = require('./routes/checklists');
const quotesRoutes = require('./routes/quotes'); 
// Load environment variables from .env file
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(refreshTokenRoute);

// Use the regulations routes
app.use('/api/regulations', regulationsRouter);

app.use('/api/logistics', logisticsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/shipping', shippingRouter);
// Setup Morgan to use Winston's stream
app.use(
  morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()), // Trim to remove trailing newline
    },
  })
);

// Public Routes
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/checklists', checklistsRouter);
app.use('/api/quotes', quotesRoutes);

// Protected Routes
//app.use('/api/products', authMiddleware, productsRouter); // Re-enable authMiddleware after testing
app.use('/api/messages', authMiddleware, messagesRouter);
app.use('/api/orders', authMiddleware, ordersRouter);

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

// Error Handling Middleware (Must be after all other app.use() and routes)
app.use(errorHandler);

// Start the server
const PORT = process.env.PORT || 5000;
try {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
} catch (error) {
  logger.error(`Failed to start server: ${error.message}`);
  process.exit(1);
}