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
    const { productId, quantity } = req.body;
    const buyerId = req.user.id;
    const buyerName = req.user.fullName || 'Buyer';

    // Input Validation
    if (!productId || typeof productId !== 'string') {
      logger.warn(`Invalid productId received: ${productId}`);
      return res.status(400).json({ message: 'Invalid or missing productId.' });
    }
    if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
      logger.warn(`Invalid quantity received: ${quantity}`);
      return res.status(400).json({ message: 'Quantity must be a positive integer.' });
    }

    // Fetch product details
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
          p.PRODUCT_ID = ? AND u.ROLE = 'seller'
      `,
      binds: [productId],
    });

    if (!productResult || productResult.length === 0) {
      logger.warn(`Product not found for productId: ${productId}`);
      return res.status(404).json({ message: 'Product not found.' });
    }

    const product = productResult[0];
    const sellerId = product.SELLER_ID;
    const sellerEmail = product.SELLER_EMAIL;
    const sellerName = product.SELLER_NAME;

    // Insert quote into database
    const quoteId = uuidv4();
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

    logger.info(`Quote inserted: QuoteID=${quoteId}, ProductID=${productId}, BuyerID=${buyerId}, Quantity=${quantity}`);

    // Log activity
    const activityMessage = `New quote requested for product "${product.PRODUCT_NAME}" by ${buyerName}.`;
    await logActivity(sellerId, activityMessage, 'quote');
    logger.info(`Activity logged: ${activityMessage}`);

    // Send email via SendGrid
    try {
      await sendQuoteRequestEmail(
        sellerEmail,
        sellerName,
        buyerName,
        product.PRODUCT_NAME,
        quantity,
        quoteId
      );
      logger.info(`Quote request email sent: QuoteID=${quoteId}, SellerEmail=${sellerEmail}`);
    } catch (emailError) {
      logger.error(`Failed to send quote request email: QuoteID=${quoteId}, Error=${emailError.message}`);
      return res.status(500).json({
        message: 'Quote requested successfully, but failed to send email notification to the seller.',
        quoteId,
      });
    }

    // Respond to buyer
    res.status(201).json({ message: 'Quote requested successfully.', quoteId });
  } catch (error) {
    logger.error(`Unexpected error in /api/quotes: ${error.message}`, error);
    res.status(500).json({ message: 'An error occurred while creating the quote.', error: error.message });
  }
});

// POST /api/quotes/:id/respond - Respond to a quote request 
router.post('/:id/respond', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { price, notes } = req.body;
    const sellerId = req.user.id;

    // Validate input
    if (!price || typeof price !== 'number' || price <= 0) {
      return res.status(400).json({ message: 'Invalid price. Must be a positive number.' });
    }

    // Check if the quote exists and belongs to the seller
    const quoteResult = await db.execute({
      sqlText: `
        SELECT * FROM trade.gwtrade.QUOTES
        WHERE QUOTE_ID = ? AND SELLER_ID = ?
      `,
      binds: [id, sellerId],
    });

    if (quoteResult.length === 0) {
      return res.status(404).json({ message: 'Quote not found or you do not have permission to respond to this quote.' });
    }

    // Update the quote with the response
    await db.execute({
      sqlText: `
        UPDATE trade.gwtrade.QUOTES
        SET STATUS = 'Responded', PRICE = ?, SELLER_NOTES = ?, RESPONDED_AT = CURRENT_TIMESTAMP()
        WHERE QUOTE_ID = ?
      `,
      binds: [price, notes, id],
    });

    // Log activity
    await logActivity(sellerId, `Responded to quote request ${id}`, 'quote');

    // Send notification to the buyer (you can implement this later)

    res.status(200).json({ message: 'Quote response submitted successfully.' });
  } catch (error) {
    console.error('Error responding to quote:', error);
    res.status(500).json({ message: 'An error occurred while responding to the quote.', error: error.message });
  }
});

// GET /api/quotes/:id - Get a specific quote
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    let quote;
    if (role === 'seller') {
      quote = await db.execute({
        sqlText: `
          SELECT q.*, p.NAME AS PRODUCT_NAME, u.FULL_NAME AS BUYER_NAME
          FROM trade.gwtrade.QUOTES q
          JOIN trade.gwtrade.PRODUCTS p ON q.PRODUCT_ID = p.PRODUCT_ID
          JOIN trade.gwtrade.USERS u ON q.BUYER_ID = u.USER_ID
          WHERE q.QUOTE_ID = ? AND q.SELLER_ID = ?
        `,
        binds: [id, userId],
      });
    } else if (role === 'buyer') {
      quote = await db.execute({
        sqlText: `
          SELECT q.*, p.NAME AS PRODUCT_NAME, u.FULL_NAME AS SELLER_NAME
          FROM trade.gwtrade.QUOTES q
          JOIN trade.gwtrade.PRODUCTS p ON q.PRODUCT_ID = p.PRODUCT_ID
          JOIN trade.gwtrade.USERS u ON q.SELLER_ID = u.USER_ID
          WHERE q.QUOTE_ID = ? AND q.BUYER_ID = ?
        `,
        binds: [id, userId],
      });
    } else {
      return res.status(403).json({ message: 'Access denied.' });
    }

    if (quote.length === 0) {
      return res.status(404).json({ message: 'Quote not found or you do not have permission to view this quote.' });
    }

    res.status(200).json(quote[0]);
  } catch (error) {
    console.error('Error fetching quote:', error);
    res.status(500).json({ message: 'An error occurred while fetching the quote.', error: error.message });
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
