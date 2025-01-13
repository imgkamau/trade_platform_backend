const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
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

// Setup Socket.IO with auth
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Socket.IO middleware for authentication
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    console.log('Auth attempt with token:', token ? 'Present' : 'Missing');
    
    if (!token) {
      throw new Error('Authentication token required');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded.user;
    console.log('User authenticated:', socket.user.id);
    next();
  } catch (error) {
    console.error('Socket auth error:', error.message);
    next(new Error('Authentication failed'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id, 'User:', socket.user.id);

  // Join chat room
  socket.on('join_chat', ({ recipientId }) => {
    const roomId = [socket.user.id, recipientId].sort().join('-');
    socket.join(roomId);
    console.log(`User ${socket.user.id} joined room ${roomId}`);
  });

  // Handle messages
  socket.on('send_message', (messageData) => {
    try {
      const roomId = [socket.user.id, messageData.recipientId].sort().join('-');
      
      const message = {
        id: require('crypto').randomUUID(),
        senderId: socket.user.id,
        recipientId: messageData.recipientId,
        text: messageData.text,
        timestamp: new Date().toISOString()
      };

      // Broadcast to room
      io.to(roomId).emit('message', message);
      console.log(`Message sent in room ${roomId}:`, message);

    } catch (error) {
      console.error('Message handling error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id, 'User:', socket.user.id);
  });
});

// Server startup
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log(`Server starting on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV);
  console.log('Socket.IO server enabled with auth');
  console.log('=================================');
}).on('error', (error) => {
  console.error('Server startup error:', error);
});
