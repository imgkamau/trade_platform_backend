const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const snowflake = require('snowflake-sdk');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);
const connectedUsers = new Map();

// Create Snowflake connection
const connection = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT,
  username: process.env.SNOWFLAKE_USERNAME,
  password: process.env.SNOWFLAKE_PASSWORD,
  database: process.env.SNOWFLAKE_DATABASE,
  schema: process.env.SNOWFLAKE_SCHEMA,
  warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  role: process.env.SNOWFLAKE_ROLE
});

// Connect to Snowflake
connection.connect((err, conn) => {
  if (err) {
    console.error('Unable to connect to Snowflake:', err);
    return;
  }
  console.log('Successfully connected to Snowflake');
});

async function getChatHistory(userId, recipientId) {
  return new Promise((resolve, reject) => {
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

    connection.execute({
      sqlText: query,
      binds: [userId, recipientId, recipientId, userId],
      complete: (err, stmt, rows) => {
        if (err) {
          console.error('Failed to execute query:', err);
          resolve([]);
          return;
        }
        if (rows && rows.length > 0) {
          console.log('Query executed successfully. Row count:', rows.length);
          // Transform the rows to match expected case
          const transformedRows = rows.map(row => ({
            id: row.ID,
            senderId: row.SENDERID,
            recipientId: row.RECIPIENTID,
            text: row.TEXT,
            timestamp: row.TIMESTAMP,
            isRead: row.ISREAD
          }));
          console.log('First transformed message:', transformedRows[0]);
          resolve(transformedRows);
        } else {
          console.log('No chat history found.');
          resolve([]);
        }
      }
    });
  });
}

async function saveMessage(message) {
  return new Promise((resolve, reject) => {
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

    connection.execute({
      sqlText: query,
      binds: [
        message.id,
        message.senderId,
        message.recipientId,
        message.text,
        message.timestamp,
        false
      ],
      complete: (err, stmt) => {
        if (err) {
          console.error('Failed to save message:', err);
          resolve(false);
          return;
        }
        console.log('Message saved successfully:', message.id);
        resolve(true);
      }
    });
  });
}

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
  console.log('Client connected:', {
    socketId: socket.id,
    userId: socket.user.id,
    connectedUsers: Array.from(connectedUsers.entries())
  });
  connectedUsers.set(socket.user.id, socket.id);

  socket.on('join_chat', async ({ recipientId }) => {
    try {
      const roomId = [socket.user.id, recipientId].sort().join('-');
      socket.join(roomId);
      console.log('Chat room joined:', {
        roomId,
        userId: socket.user.id,
        recipientId,
        activeRooms: Array.from(socket.rooms)
      });

      const history = await getChatHistory(socket.user.id, recipientId);
      console.log('Chat history retrieved:', {
        userId: socket.user.id,
        recipientId,
        messageCount: history.length,
        firstMessage: history[0],
        lastMessage: history[history.length - 1]
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

      console.log('Processing new message:', {
        messageId: message.id,
        senderId: message.senderId,
        recipientId: message.recipientId,
        roomId: [message.senderId, message.recipientId].sort().join('-')
      });

      const saved = await saveMessage(message);
      if (!saved) {
        throw new Error('Failed to save message');
      }

      const roomId = [socket.user.id, messageData.recipientId].sort().join('-');
      console.log('Broadcasting message to room:', {
        roomId,
        activeRooms: Array.from(socket.rooms),
        recipientConnected: connectedUsers.has(messageData.recipientId)
      });

      io.to(roomId).emit('message', message);
      
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
    console.log('Client disconnected:', {
      socketId: socket.id,
      userId: socket.user.id,
      remainingUsers: Array.from(connectedUsers.entries())
    });
    connectedUsers.delete(socket.user.id);
  });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log(`WebSocket server running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV);
  console.log('=================================');
});
