const express = require('express');
const { createServer } = require('http');
const cors = require('cors');
const { setupWebSocket } = require('./services/socket');
const dotenv = require('dotenv');

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

const app = express();

// Basic error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// CORS and other middleware
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = setupWebSocket(server);

// Health check with detailed response
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.status(200).json({ 
    status: 'OK', 
    service: 'WebSocket Server',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV);
  console.log('Node version:', process.version);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing WebSocket server...');
  server.close(() => {
    console.log('WebSocket server closed');
    process.exit(0);
  });
});
