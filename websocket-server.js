const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const snowflake = require('./db');  // Your Snowflake connection

const app = express();
const connectedUsers = new Map();

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

// Add function to save message to database
async function saveMessage(message) {
  const query = `
    INSERT INTO CHAT_MESSAGES (
      MESSAGE_ID,
      SENDER_ID,
      RECIPIENT_ID,
      MESSAGE_TEXT,
      TIMESTAMP,
      IS_READ
    ) VALUES (?, ?, ?, ?, ?, ?)
  `;

  try {
    await snowflake.execute({
      sqlText: query,
      binds: [
        message.id,
        message.senderId,
        message.recipientId,
        message.text,
        message.timestamp,
        false  // Initially unread
      ]
    });
    console.log('Message saved to database:', message.id);
    return true;
  } catch (error) {
    console.error('Error saving message:', error);
    return false;
  }
}

// Add function to get chat history
async function getChatHistory(userId, recipientId) {
  const query = `
    SELECT 
      MESSAGE_ID as id,
      SENDER_ID as senderId,
      RECIPIENT_ID as recipientId,
      MESSAGE_TEXT as text,
      TIMESTAMP as timestamp,
      IS_READ as isRead
    FROM CHAT_MESSAGES 
    WHERE (SENDER_ID = ? AND RECIPIENT_ID = ?)
       OR (SENDER_ID = ? AND RECIPIENT_ID = ?)
    ORDER BY TIMESTAMP DESC
  `;

  try {
    console.log('Fetching chat history for:', { userId, recipientId });
    const result = await snowflake.execute({
      sqlText: query,
      binds: [userId, recipientId, recipientId, userId]
    });
    console.log('Chat history result:', {
      rowCount: result.rows?.length,
      firstMessage: result.rows?.[0],
      lastMessage: result.rows?.[result.rows.length - 1]
    });
    return result.rows || [];
  } catch (error) {
    console.error('Error fetching chat history:', error);
    return [];
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id, 'User:', socket.user.id);
  connectedUsers.set(socket.user.id, socket.id);

  // When joining chat, send history
  socket.on('join_chat', async ({ recipientId }) => {
    try {
      const roomId = [socket.user.id, recipientId].sort().join('-');
      socket.join(roomId);
      console.log(`User ${socket.user.id} joined room ${roomId}`);

      const history = await getChatHistory(socket.user.id, recipientId);
      console.log('Sending chat history to user:', {
        userId: socket.user.id,
        recipientId,
        messageCount: history.length
      });
      
      socket.emit('chat_history', history);
    } catch (error) {
      console.error('Error in join_chat:', error);
      socket.emit('error', { message: 'Failed to load chat history' });
    }
  });

  socket.on('send_message', async (messageData) => {
    try {
      const message = {
        id: require('crypto').randomUUID(),
        senderId: socket.user.id,
        recipientId: messageData.recipientId,
        text: messageData.text,
        timestamp: new Date().toISOString(),
        isRead: false
      };

      // Save to database first
      const saved = await saveMessage(message);
      if (!saved) {
        throw new Error('Failed to save message');
      }

      // Broadcast to room if recipient is online
      const roomId = [socket.user.id, messageData.recipientId].sort().join('-');
      io.to(roomId).emit('message', message);

      // Confirm to sender
      socket.emit('message_sent', { 
        success: true, 
        messageId: message.id,
        delivered: connectedUsers.has(messageData.recipientId)
      });

    } catch (error) {
      console.error('Message handling error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('disconnect', () => {
    connectedUsers.delete(socket.user.id);
    console.log('Client disconnected:', socket.id);
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
