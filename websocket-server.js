const express = require('express');
const app = express();

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

// Basic middleware with error logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Simple routes with logging
app.get('/', (req, res) => {
  console.log('Root route hit');
  res.send('Server is running');
});

app.get('/health', (req, res) => {
  console.log('Health check hit');
  res.send('OK');
});

// Server startup with detailed logging
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log(`Server starting on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV);
  console.log('Current directory:', process.cwd());
  console.log('Node version:', process.version);
  console.log('=================================');
}).on('error', (error) => {
  console.error('Server startup error:', error);
});
