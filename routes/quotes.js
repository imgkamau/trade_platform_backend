// routes/quotes.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const authMiddleware = require('../middleware/auth');

// POST /api/quotes - Request a new quote
router.post('/', authMiddleware, async (req, res) => {
    const { productId, quantity, sellerId } = req.body; // Include sellerId in the request
    const buyerId = req.user.id; // Assuming the user ID is stored in the request

    // Validate input
    if (!productId || !quantity || !sellerId) {
        return res.status(400).json({ message: 'Product ID, quantity, and seller ID are required' });
    }

    try {
        const quoteId = uuidv4(); // Generate a unique ID for the quote

        // Insert the quote request into the database
        await db.execute({
            sqlText: `INSERT INTO QUOTES (QUOTE_ID, PRODUCT_ID, BUYER_ID, QUANTITY, SELLER_ID, STATUS) VALUES (?, ?, ?, ?, ?, ?)`,
            binds: [quoteId, productId, buyerId, quantity, sellerId, 'Pending'],
        });

        // Trigger a notification to the seller
        await notifySeller(sellerId, quoteId);

        res.status(201).json({ message: 'Quote requested successfully', quoteId: quoteId });
    } catch (error) {
        console.error('Error requesting quote:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Mock function to send notification to the seller
const notifySeller = async (sellerId, quoteId) => {
    // Implement your notification logic here
    console.log(`Notification sent to seller ${sellerId} for quote ${quoteId}`);
};

// GET /api/quotes - Get all quotes for the logged-in user
router.get('/', authMiddleware, async (req, res) => {
    const buyerId = req.user.id;

    try {
        const quotes = await db.execute({
            sqlText: `SELECT * FROM QUOTES WHERE BUYER_ID = ?`,
            binds: [buyerId],
        });
        res.json(quotes);
    } catch (error) {
        console.error('Error fetching quotes:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
