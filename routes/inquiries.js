// routes/inquiries.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Your database module
const { v4: uuidv4 } = require('uuid');
const { verifyToken, verifyRole } = require('../middleware/auth'); // New auth middleware

// POST /api/inquiries - Create a product inquiry
router.post('/', verifyToken, verifyRole(['buyer']), async (req, res) => {
    const { productId, inquiry } = req.body;
    const buyerId = req.user.id;

    if (!productId || !inquiry) {
        return res.status(400).json({ message: 'Product ID and inquiry are required' });
    }

    try {
        // Fetch product details
        const productResult = await db.execute({
            sqlText: `SELECT SELLER_ID FROM trade.gwtrade.PRODUCTS WHERE PRODUCT_ID = ?`,
            binds: [productId],
        });

        if (!productResult || productResult.length === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const sellerId = productResult[0].SELLER_ID;

        // Insert the inquiry
        const inquiryId = uuidv4();
        await db.execute({
            sqlText: `
                INSERT INTO trade.gwtrade.INQUIRIES (INQUIRY_ID, BUYER_ID, SELLER_ID, PRODUCT_ID, CONTENT, CREATED_AT)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `,
            binds: [inquiryId, buyerId, sellerId, productId, inquiry],
        });

        // Create a conversation
        const conversationId = uuidv4();
        await db.execute({
            sqlText: `
                INSERT INTO trade.gwtrade.CONVERSATIONS (CONVERSATION_ID, SELLER_ID, BUYER_ID, PRODUCT_ID)
                VALUES (?, ?, ?, ?)
            `,
            binds: [conversationId, sellerId, buyerId, productId],
        });

        res.status(201).json({ message: 'Inquiry submitted successfully', inquiryId });
    } catch (error) {
        console.error('Error submitting inquiry:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
