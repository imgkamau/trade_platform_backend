const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

function setupWebSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    console.log('Socket auth attempt');
    try {
      const token = socket.handshake.auth.token;
      console.log('Token received:', token ? 'present' : 'missing');
      
      if (!token) {
        throw new Error('No token provided');
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token decoded:', decoded);
      
      if (!decoded || !decoded.user) {
        throw new Error('Invalid token structure');
      }

      socket.user = decoded.user;
      console.log('User authenticated:', socket.user);
      next();
    } catch (err) {
      console.error('Socket auth error:', err.message);
      next(new Error('Authentication error'));
    }
  });

  // Handle connections
  io.on('connection', (socket) => {
    console.log('User connected:', socket.user.id);
    
    // Join a room specific to this chat
    socket.on('join_chat', ({ recipientId }) => {
      const roomId = [socket.user.id, recipientId].sort().join('-');
      socket.join(roomId);
      console.log(`User ${socket.user.id} joined room ${roomId}`);
    });

    socket.on('send_message', async (messageData) => {
      try {
        const roomId = [socket.user.id, messageData.recipientId].sort().join('-');
        
        const message = {
          id: require('crypto').randomUUID(),
          senderId: socket.user.id,
          recipientId: messageData.recipientId,
          text: messageData.text,
          timestamp: new Date().toISOString()
        };

        // Save message to database
        await saveMessageToDb(message);

        // Broadcast to room
        io.to(roomId).emit('message', message);
        
        console.log(`Message sent in room ${roomId}`);
      } catch (error) {
        console.error('Message handling error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.user.id);
    });
  });

  return io;
}

async function saveMessageToDb(message) {
  const db = require('../db');
  const query = `
    INSERT INTO CHAT_MESSAGES (
      MESSAGE_ID, 
      SENDER_ID, 
      RECIPIENT_ID, 
      MESSAGE_TEXT, 
      TIMESTAMP
    ) VALUES (?, ?, ?, ?, ?)
  `;

  try {
    await db.execute({
      sqlText: query,
      binds: [
        message.id,
        message.senderId,
        message.recipientId,
        message.text,
        message.timestamp
      ]
    });
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
}

module.exports = { setupWebSocket }; 