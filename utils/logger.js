// utils/logger.js

const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize } = format;

// Define a custom log format
const customFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`;
});

// Create the logger instance
const logger = createLogger({
  level: 'debug', // Log level: 'error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    customFormat
  ),
  transports: [
    // Log errors to error.log
    new transports.File({ filename: 'error.log', level: 'error' }),

    // Log all levels to combined.log
    new transports.File({ filename: 'combined.log' }),
  ],
});

// If we're not in production, also log to the console with colorized output
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        customFormat
      ),
    })
  );
}

module.exports = logger;
