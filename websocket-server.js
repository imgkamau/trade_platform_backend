const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
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

// Simple routes
app.get('/', (req, res) => {
  console.log('Root route hit');
  res.send('Server is running');
});

app.get('/health', (req, res) => {
  console.log('Health check hit');
  res.send('OK');
});

// Create HTTP server
const httpServer = createServer(app);

// Setup Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Basic Socket.IO connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Server startup with detailed logging
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log(`Server starting on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV);
  console.log('Socket.IO server enabled');
  console.log('=================================');
}).on('error', (error) => {
  console.error('Server startup error:', error);
});
