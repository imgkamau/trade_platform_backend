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
  origin: env === 'production'
    ? process.env.FRONTEND_URL || 'https://ke-eutrade.org'
    : process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST'],
  credentials: true,
};

app.use(cors(corsOptions));

const server = createServer(app);
const io = setupWebSocket(server);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'WebSocket Server' });
});

const PORT = process.env.SOCKET_PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing WebSocket server...');
  server.close(() => {
    console.log('WebSocket server closed');
    process.exit(0);
  });
});
