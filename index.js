// trade-platform-backend/index.js

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
// Import the logger
const logger = require('./utils/logger');

// Load environment variables from .env file
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Setup Morgan to use Winston's stream
app.use(
  morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()), // Trim to remove trailing newline
    },
  })
);

// Import Routes
const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const messagesRouter = require('./routes/messages');
const ordersRouter = require('./routes/orders'); // Import the orders router
const authMiddleware = require('./middleware/auth');

// Public Routes
app.use('/api/auth', authRouter);

// Protected Routes
//app.use('/api/products', authMiddleware, productsRouter);
app.use('/api/products', productsRouter); // Removed authMiddleware for testing
app.use('/api/messages', authMiddleware, messagesRouter);
app.use('/api/orders', authMiddleware, ordersRouter); // Register the orders router with authMiddleware

// Root Route
app.get('/', (req, res) => {
  res.send('Welcome to the Products API');
});

// Error Handling Middleware (Must be after all other app.use() and routes)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
