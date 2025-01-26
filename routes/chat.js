const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const db = require('../db');

// Get chat history between two users
router.get('/history/:recipientId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { recipientId } = req.params;

    const query = `
      SELECT 
        MESSAGE_ID as id,
        SENDER_ID as senderId,
        MESSAGE_TEXT as text,
        TIMESTAMP as timestamp,
        IS_READ as isRead
      FROM TRADE.GWTRADE.CHAT_MESSAGES 
      WHERE (SENDER_ID = ? AND RECIPIENT_ID = ?)
         OR (SENDER_ID = ? AND RECIPIENT_ID = ?)
      ORDER BY TIMESTAMP DESC
      LIMIT 50
    `;

    const result = await db.execute({
      sqlText: query,
      binds: [userId, recipientId, recipientId, userId]
    });

    res.json(result.rows || []);
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ message: 'Failed to fetch chat history' });
  }
});

// Get user's conversations
router.get('/conversations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const query = `
      WITH LastMessages AS (
        SELECT 
          CASE 
            WHEN SENDER_ID = ? THEN RECIPIENT_ID 
            ELSE SENDER_ID 
          END as OTHER_USER_ID,
          MESSAGE_TEXT,
          TIMESTAMP,
          ROW_NUMBER() OVER (PARTITION BY 
            CASE 
              WHEN SENDER_ID = ? THEN RECIPIENT_ID 
              ELSE SENDER_ID 
            END 
            ORDER BY TIMESTAMP DESC
          ) as rn
        FROM CHAT_MESSAGES 
        WHERE SENDER_ID = ? OR RECIPIENT_ID = ?
      )
      SELECT 
        m.OTHER_USER_ID as userId,
        u.FULL_NAME as userName,
        m.MESSAGE_TEXT as lastMessage,
        m.TIMESTAMP as timestamp
      FROM LastMessages m
      JOIN USERS u ON u.USER_ID = m.OTHER_USER_ID
      WHERE m.rn = 1
      ORDER BY m.TIMESTAMP DESC
    `;

    const result = await db.execute({
      sqlText: query,
      binds: [userId, userId, userId, userId]
    });

    res.json(result.rows || []);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

module.exports = router; 