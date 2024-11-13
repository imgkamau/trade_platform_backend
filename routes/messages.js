// routes/messages.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Your database module
const { v4: uuidv4 } = require('uuid'); // For generating UUIDs
const authMiddleware = require('../middleware/auth'); // Authentication middleware
const authorize = require('../middleware/authorize'); // Authorization middleware

// GET /api/messages/:conversationId - Get all messages in a conversation
router.get('/:conversationId', authMiddleware, authorize(['buyer', 'seller']), async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user.id;

    try {
        // Verify that the user is part of the conversation
        const conversation = await db.execute({
            sqlText: `
                SELECT * FROM trade.gwtrade.CONVERSATIONS
                WHERE CONVERSATION_ID = ? AND (SELLER_ID = ? OR BUYER_ID = ?)
            `,
            binds: [conversationId, userId, userId],
        });

        if (!conversation || conversation.length === 0) {
            return res.status(404).json({ message: 'Conversation not found or access denied' });
        }

        // Fetch messages
        const messages = await db.execute({
            sqlText: `
                SELECT 
                    MESSAGE_ID,
                    SENDER_ID,
                    RECIPIENT_ID,
                    CONTENT,
                    TIMESTAMP
                FROM trade.gwtrade.MESSAGES
                WHERE CONVERSATION_ID = ?
                ORDER BY TIMESTAMP ASC
            `,
            binds: [conversationId],
        });

        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// POST /api/messages - Send a new message
router.post('/', authMiddleware, authorize(['buyer', 'seller']), async (req, res) => {
    const { recipient_id, content, conversation_id } = req.body;
    const senderId = req.user.id;

    if (!recipient_id || !content) {
        return res.status(400).json({ message: 'Recipient ID and content are required' });
    }

    try {
        let conversationId = conversation_id;

        // If conversation_id is not provided, attempt to find or create one
        if (!conversationId) {
            // Fetch the user's role
            const userResult = await db.execute({
                sqlText: `SELECT ROLE FROM trade.gwtrade.USERS WHERE USER_ID = ?`,
                binds: [senderId],
            });

            if (!userResult || userResult.length === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            const senderRole = userResult[0].ROLE;

            // Fetch recipient's role
            const recipientResult = await db.execute({
                sqlText: `SELECT ROLE FROM trade.gwtrade.USERS WHERE USER_ID = ?`,
                binds: [recipient_id],
            });

            if (!recipientResult || recipientResult.length === 0) {
                return res.status(404).json({ message: 'Recipient not found' });
            }

            const recipientRole = recipientResult[0].ROLE;

            // Determine seller and buyer
            let sellerId, buyerId;
            if (senderRole === 'seller' && recipientRole === 'buyer') {
                sellerId = senderId;
                buyerId = recipient_id;
            } else if (senderRole === 'buyer' && recipientRole === 'seller') {
                sellerId = recipient_id;
                buyerId = senderId;
            } else {
                return res.status(400).json({ message: 'Invalid roles for conversation' });
            }

            // Find existing conversation
            const existingConversation = await db.execute({
                sqlText: `
                    SELECT CONVERSATION_ID trade.gwtrade.FROM CONVERSATIONS
                    WHERE SELLER_ID = ? AND BUYER_ID = ? AND PRODUCT_ID IS NULL
                    LIMIT 1
                `,
                binds: [sellerId, buyerId],
            });

            if (existingConversation && existingConversation.length > 0) {
                conversationId = existingConversation[0].CONVERSATION_ID;
            } else {
                // Create new conversation
                conversationId = uuidv4();
                await db.execute({
                    sqlText: `
                        INSERT INTO trade.gwtrade.CONVERSATIONS (CONVERSATION_ID, SELLER_ID, BUYER_ID, PRODUCT_ID)
                        VALUES (?, ?, ?, NULL)
                    `,
                    binds: [conversationId, sellerId, buyerId],
                });
            }
        } else {
            // Verify that the user is part of the conversation
            const conversation = await db.execute({
                sqlText: `
                    SELECT * FROM trade.gwtrade.CONVERSATIONS
                    WHERE CONVERSATION_ID = ? AND (SELLER_ID = ? OR BUYER_ID = ?)
                `,
                binds: [conversationId, senderId, senderId],
            });

            if (!conversation || conversation.length === 0) {
                return res.status(404).json({ message: 'Conversation not found or access denied' });
            }
        }

        // Insert the new message
        const messageId = uuidv4();
        const timestamp = new Date().toISOString();

        await db.execute({
            sqlText: `
                INSERT INTO trade.gwtrade.MESSAGES (MESSAGE_ID, CONVERSATION_ID, SENDER_ID, RECIPIENT_ID, CONTENT, TIMESTAMP)
                VALUES (?, ?, ?, ?, ?, ?)
            `,
            binds: [messageId, conversationId, senderId, recipient_id, content, timestamp],
        });

        res.status(201).json({
            MESSAGE_ID: messageId,
            SENDER_ID: senderId,
            RECIPIENT_ID: recipient_id,
            CONTENT: content,
            TIMESTAMP: timestamp,
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
