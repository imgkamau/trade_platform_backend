// routes/contacts.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Your database module
const { v4: uuidv4 } = require('uuid');
const { verifyToken, verifyRole } = require('../middleware/auth'); // New auth middleware

// POST /api/contacts - Seller initiates contact with a buyer
router.post('/', verifyToken, verifyRole(['seller']), async (req, res) => {
    const { buyerId, message, productId } = req.body;
    const sellerId = req.user.id;

    if (!buyerId || !message) {
        return res.status(400).json({ message: 'Buyer ID and message are required' });
    }

    try {
        // Check if the buyer exists
        const buyerResult = await db.execute({
            sqlText: `SELECT * FROM trade.gwtrade.USERS WHERE USER_ID = ? AND ROLE = 'buyer'`,
            binds: [buyerId],
        });

        if (!buyerResult || buyerResult.length === 0) {
            return res.status(404).json({ message: 'Buyer not found' });
        }

        // Automatically create a conversation
        const conversationId = uuidv4();
        await db.execute({
            sqlText: `
                INSERT INTO trade.gwtrade.CONVERSATIONS (CONVERSATION_ID, SELLER_ID, BUYER_ID, PRODUCT_ID)
                VALUES (?, ?, ?, ?)
            `,
            binds: [conversationId, sellerId, buyerId, productId || null],
        });

        // Send the initial message
        const messageId = uuidv4();
        const timestamp = new Date().toISOString();

        await db.execute({
            sqlText: `
                INSERT INTO trade.gwtrade.MESSAGES (MESSAGE_ID, CONVERSATION_ID, SENDER_ID, RECIPIENT_ID, CONTENT, TIMESTAMP)
                VALUES (?, ?, ?, ?, ?, ?)
            `,
            binds: [messageId, conversationId, sellerId, buyerId, message, timestamp],
        });

        res.status(201).json({ message: 'Contact initiated successfully', conversationId, messageId });
    } catch (error) {
        console.error('Error initiating contact:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
