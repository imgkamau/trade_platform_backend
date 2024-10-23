// routes/messages.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');

// Send a message
router.post('/', authMiddleware, async (req, res) => {
  const { recipient_id, content } = req.body;
  const sender_id = req.user.id;

  if (!recipient_id || !content) {
    return res.status(400).json({ message: 'Recipient and content are required' });
  }

  try {
    // Create a new message
    const MESSAGE_ID = uuidv4();

    await db.execute({
      sqlText: `INSERT INTO MESSAGES (
        MESSAGE_ID,
        SENDER_ID,
        RECIPIENT_ID,
        CONTENT
      ) VALUES (?, ?, ?, ?)`,
      binds: [MESSAGE_ID, sender_id, recipient_id, content],
    });

    res.status(201).json({ message: 'Message sent successfully' });
  } catch (error) {
    console.error('Message sending error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get messages between the authenticated user and another user
router.get('/:userId', authMiddleware, async (req, res) => {
  const userId = req.params.userId;
  const currentUserId = req.user.id;

  try {
    const messages = await db.execute({
      sqlText: `SELECT * FROM MESSAGES
        WHERE (SENDER_ID = ? AND RECIPIENT_ID = ?)
        OR (SENDER_ID = ? AND RECIPIENT_ID = ?)
        ORDER BY TIMESTAMP ASC`,
      binds: [currentUserId, userId, userId, currentUserId],
    });

    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get list of conversations for the authenticated user
router.get('/', authMiddleware, async (req, res) => {
  const currentUserId = req.user.id;

  try {
    const conversations = await db.execute({
      sqlText: `
        SELECT DISTINCT
          CASE
            WHEN SENDER_ID = ? THEN RECIPIENT_ID
            ELSE SENDER_ID
          END AS USER_ID
        FROM MESSAGES
        WHERE SENDER_ID = ? OR RECIPIENT_ID = ?
      `,
      binds: [currentUserId, currentUserId, currentUserId],
    });

    // Extract user IDs from the result
    const userIds = conversations.map((row) => row.USER_ID);

    if (userIds.length === 0) {
      return res.json([]); // No conversations
    }

    // Fetch user details for each conversation
    const users = await db.execute({
      sqlText: `
        SELECT USER_ID, USERNAME, FULL_NAME, COMPANY_NAME
        FROM USERS
        WHERE USER_ID IN (${userIds.map(() => '?').join(',')})
      `,
      binds: userIds,
    });

    res.json(users);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
