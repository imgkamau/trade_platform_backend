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

// Add health check endpoint
app.get('/health', (req, res) => {
  try {
    // Check database connection
    const dbHealthy = connection && connection.isUp();
    
    if (dbHealthy) {
      res.status(200).json({
        status: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        database: 'disconnected',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Add this function to get conversations for a user
async function getUserConversations(userId) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT DISTINCT
        m1.SENDER_ID,
        m1.RECIPIENT_ID,
        m2.MESSAGE_TEXT as last_message,
        m2.TIMESTAMP as last_message_time,
        (
          SELECT COUNT(*)
          FROM CHAT_MESSAGES
          WHERE RECIPIENT_ID = ?
          AND SENDER_ID IN (m1.SENDER_ID, m1.RECIPIENT_ID)
          AND IS_READ = false
        ) as unread_count
      FROM CHAT_MESSAGES m1
      JOIN CHAT_MESSAGES m2 ON (
        (m2.SENDER_ID = m1.SENDER_ID AND m2.RECIPIENT_ID = m1.RECIPIENT_ID) OR
        (m2.SENDER_ID = m1.RECIPIENT_ID AND m2.RECIPIENT_ID = m1.SENDER_ID)
      )
      WHERE ? IN (m1.SENDER_ID, m1.RECIPIENT_ID)
      GROUP BY m1.SENDER_ID, m1.RECIPIENT_ID
      ORDER BY MAX(m2.TIMESTAMP) DESC
    `;

    connection.execute({
      sqlText: query,
      binds: [userId, userId],
      complete: (err, stmt, rows) => {
        if (err) {
          console.error('Failed to fetch conversations:', err);
          resolve([]);
          return;
        }
        console.log('Conversations found:', rows?.length || 0);
        resolve(rows || []);
      }
    });
  });
}

// Add an endpoint to get conversations
app.get('/chat/conversations', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.user.id;

    const conversations = await getUserConversations(userId);
    console.log(`Found ${conversations.length} conversations for user ${userId}`);

    res.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

// Update your server startup
httpServer.listen(process.env.PORT || 8080, () => {
  console.log('=================================');
  console.log(`Server running on port ${process.env.PORT || 8080}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('=================================');
});
