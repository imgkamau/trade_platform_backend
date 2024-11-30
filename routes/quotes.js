// routes/quotes.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');
const logActivity = require('../utils/activityLogger');
const { sendQuoteRequestEmail } = require('../utils/emailService'); // Import the SendGrid function

// POST /api/quotes - Request a new quote
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, quantity } = req.body; // 'name' refers to product name
    const buyerId = req.user.id; // Buyer ID from authenticated user
    const buyerName = req.user.fullName || 'Buyer'; // Adjust based on your user data structure

    // **Input Validation**
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Product name is required and must be a string.' });
    }
    if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ message: 'Quantity must be a positive integer.' });
    }

    // **Fetch the product details including the seller's ID and email**
    const productResult = await db.execute({
      sqlText: `
        SELECT 
          p.PRODUCT_ID,
          p.NAME AS PRODUCT_NAME,
          p.DESCRIPTION,
          p.SELLER_ID,
          u.EMAIL AS SELLER_EMAIL,
          u.FULL_NAME AS SELLER_NAME
        FROM 
          trade.gwtrade.PRODUCTS p
        JOIN 
          trade.gwtrade.USERS u ON p.SELLER_ID = u.USER_ID
        WHERE 
          p.NAME = ? AND u.ROLE = 'seller'
      `,
      binds: [name],
    });

    if (!productResult || productResult.length === 0) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    // **Handle multiple products with the same name**
    if (productResult.length > 1) {
      return res.status(400).json({
        message: 'Multiple products found with that name. Please specify further.',
      });
    }

    const product = productResult[0];
    const productId = product.PRODUCT_ID;
    const sellerId = product.SELLER_ID;
    const sellerEmail = product.SELLER_EMAIL;
    const sellerName = product.SELLER_NAME;

    // **Generate a new quote ID**
    const quoteId = uuidv4();

    // **Insert the new quote into the database**
    await db.execute({
      sqlText: `
        INSERT INTO trade.gwtrade.QUOTES (
          QUOTE_ID,
          PRODUCT_ID,
          BUYER_ID,
          SELLER_ID,
          QUANTITY,
          STATUS,
          REQUESTED_AT
        ) VALUES (?, ?, ?, ?, ?, 'Pending', CURRENT_TIMESTAMP())
      `,
      binds: [quoteId, productId, buyerId, sellerId, quantity],
    });

    // **Log activity for the seller**
    const activityMessage = `New quote requested for product "${product.PRODUCT_NAME}" by ${buyerName}.`;
    await logActivity(sellerId, activityMessage, 'quote');

    // **Send notification email to the seller using SendGrid**
    try {
      await sendQuoteRequestEmail(
        sellerEmail,
        sellerName,
        buyerName,
        product.PRODUCT_NAME,
        quantity,
        quoteId
      );
    } catch (emailError) {
      logger.error(`Failed to send quote request email to ${sellerEmail}:`, emailError);
      // **Respond to the buyer that the quote was created but email failed**
      return res.status(500).json({
        message: 'Quote requested successfully, but failed to send email notification to the seller.',
        quoteId,
      });
    }

    // **Respond to the buyer**
    res.status(201).json({ message: 'Quote requested successfully.', quoteId });
  } catch (error) {
    logger.error('Error creating quote:', error);
    res.status(500).json({ message: 'An error occurred while creating the quote.', error: error.message });
  }
});

// **GET /api/quotes - Get all quotes for a buyer or seller**
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let quotes;

    if (role === 'buyer') {
      // **Buyers fetch their own quotes**
      quotes = await db.execute({
        sqlText: `
          SELECT 
            q.QUOTE_ID,
            q.PRODUCT_ID,
            p.NAME AS PRODUCT_NAME,
            q.BUYER_ID,
            q.SELLER_ID,
            u.FULL_NAME AS SELLER_NAME,
            q.QUANTITY,
            q.STATUS,
            q.REQUESTED_AT
          FROM 
            trade.gwtrade.QUOTES q
          JOIN 
            trade.gwtrade.PRODUCTS p ON q.PRODUCT_ID = p.PRODUCT_ID
          JOIN 
            trade.gwtrade.USERS u ON q.SELLER_ID = u.USER_ID
          WHERE 
            q.BUYER_ID = ?
          ORDER BY 
            q.REQUESTED_AT DESC
        `,
        binds: [userId],
      });
    } else if (role === 'seller') {
      // **Sellers fetch quotes received for their products**
      quotes = await db.execute({
        sqlText: `
          SELECT 
            q.QUOTE_ID,
            q.PRODUCT_ID,
            p.NAME AS PRODUCT_NAME,
            q.BUYER_ID,
            u.FULL_NAME AS BUYER_NAME,
            q.QUANTITY,
            q.STATUS,
            q.REQUESTED_AT
          FROM 
            trade.gwtrade.QUOTES q
          JOIN 
            trade.gwtrade.PRODUCTS p ON q.PRODUCT_ID = p.PRODUCT_ID
          JOIN 
            trade.gwtrade.USERS u ON q.BUYER_ID = u.USER_ID
          WHERE 
            q.SELLER_ID = ?
          ORDER BY 
            q.REQUESTED_AT DESC
        `,
        binds: [userId],
      });
    } else {
      return res.status(403).json({ message: 'Access denied.' });
    }

    res.status(200).json(quotes);
  } catch (error) {
    logger.error('Error fetching quotes:', error);
    res.status(500).json({ message: 'An error occurred while fetching quotes.', error: error.message });
  }
});

module.exports = router;
