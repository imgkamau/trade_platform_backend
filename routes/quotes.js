// routes/quotes.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const authMiddleware = require('../middleware/auth');

// POST /api/quotes - Request a new quote
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        const buyerId = req.user.id; // Assuming the user ID is stored in the request

        // Fetch the product details including the seller_ID
        const productResult = await db.execute('SELECT * FROM PRODUCTS WHERE PRODUCT_ID = ?', [productId]);

        if (!productResult || productResult.length === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const sellerId = productResult[0].SELLER_ID;

        // Generate a new quote ID
        const quoteId = uuidv4();

        // Insert the new quote into the database
        await db.execute(
            'INSERT INTO QUOTES (QUOTE_ID, PRODUCT_ID, BUYER_ID, SELLER_ID, QUANTITY, STATUS) VALUES (?, ?, ?, ?, ?, ?)',
            [quoteId, productId, buyerId, sellerId, quantity, 'Pending']
        );

        // Send notification to the seller (implement this function based on your notification system)
        await notifySeller(sellerId, quoteId);

        res.status(201).json({ message: 'Quote requested successfully', quoteId });
    } catch (error) {
        console.error('Error creating quote:', error);
        res.status(500).json({ message: 'An error occurred while creating the quote' });
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
