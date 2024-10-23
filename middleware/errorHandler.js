// middleware/errorHandler.js

const logger = require('../utils/logger');

/**
 * Error Handling Middleware
 * Catches and handles errors thrown in the application.
 * Sends a generic error message to the client.
 */
const errorHandler = (err, req, res, next) => {
  // Log the error details
  logger.error(`Unhandled Error: ${err.stack}`);

  // Respond with a generic message
  res.status(500).json({ message: 'An unexpected error occurred. Please try again later.' });
};

module.exports = errorHandler;
