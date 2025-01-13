const express = require('express');
const { createServer } = require('http');
const cors = require('cors');
const { setupWebSocket } = require('./services/socket');
const dotenv = require('dotenv');
const env = process.env.NODE_ENV || 'development';
if (env !== 'production') {
  dotenv.config({ path: `.env.${env}` });
}

const app = express();

// CORS Configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

const server = createServer(app);
const io = setupWebSocket(server);

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.status(200).json({ status: 'OK', service: 'WebSocket Server' });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on port ${PORT}`);
  console.log('Environment:', env);
  console.log('CORS origin:', corsOptions.origin);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing WebSocket server...');
  server.close(() => {
    console.log('WebSocket server closed');
    process.exit(0);
  });
});
