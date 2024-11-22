// routes/sellerProducts.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Authentication and Authorization middleware
const authMiddleware = require('../middleware/auth'); // Authentication middleware
const authorize = require('../middleware/authorize'); // Authorization middleware

// Optional: Caching (if needed)
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

/**
 * @route   POST /api/seller-products
 * @desc    Seller adds a product offering
 * @access  Private (Sellers only)
 */
router.post(
  '/',
  authMiddleware,
  authorize(['seller']),
  [
    body('productId').notEmpty().withMessage('Product ID is required'),
    body('price').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
    body('stock').isInt({ gt: -1 }).withMessage('Stock must be a non-negative integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { productId, price, stock } = req.body;
    const sellerId = req.user.id;

    try {
      // Verify if the product exists
      const productResult = await db.execute({
        sqlText: `
          SELECT PRODUCT_ID FROM trade.gwtrade.PRODUCTS WHERE PRODUCT_ID = ?
        `,
        binds: [productId],
      });

      if (productResult.length === 0) {
        return res.status(404).json({ message: 'Product not found' });
      }

      // Check if the seller already offers this product
      const existingOffering = await db.execute({
        sqlText: `
          SELECT SELLER_PRODUCT_ID FROM trade.gwtrade.SELLER_PRODUCTS
          WHERE SELLER_ID = ? AND PRODUCT_ID = ?
        `,
        binds: [sellerId, productId],
      });

      if (existingOffering.length > 0) {
        return res.status(400).json({ message: 'You have already offered this product' });
      }

      const SELLER_PRODUCT_ID = uuidv4();

      // Insert into SELLER_PRODUCTS
      await db.execute({
        sqlText: `
          INSERT INTO trade.gwtrade.SELLER_PRODUCTS (
            SELLER_PRODUCT_ID,
            PRODUCT_ID,
            SELLER_ID,
            PRICE,
            STOCK
          ) VALUES (?, ?, ?, ?, ?)
        `,
        binds: [SELLER_PRODUCT_ID, productId, sellerId, price, stock],
      });

      logger.info(`Seller ${sellerId} added product ${productId} with ID ${SELLER_PRODUCT_ID}`);
      res.status(201).json({ message: 'Product offering added successfully', sellerProductId: SELLER_PRODUCT_ID });
    } catch (error) {
      logger.error('Error adding product offering:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

/**
 * @route   GET /api/seller-products
 * @desc    Get all product offerings of the authenticated seller
 * @access  Public (Previously Private)
 */
router.get('/', async (req, res) => { // Removed authMiddleware and authorize
  logger.info('Fetching all seller products');

  try {
    // Optional: Check cache first
    const cachedData = cache.get('all_seller_products');
    if (cachedData) {
      logger.info('Cache hit for all seller products');
      return res.json(cachedData);
    }

    const sellerProductsResult = await db.execute({
      sqlText: `
        SELECT 
          sp.SELLER_PRODUCT_ID,
          p.PRODUCT_ID,
          p.NAME,
          p.DESCRIPTION,
          p.CATEGORY,
          sp.PRICE,
          sp.STOCK,
          sp.SELLER_ID
        FROM trade.gwtrade.SELLER_PRODUCTS sp
        JOIN trade.gwtrade.PRODUCTS p ON sp.PRODUCT_ID = p.PRODUCT_ID
        ORDER BY sp.PRICE ASC
      `,
    });

    // Format the seller products data to match frontend's Product interface
    const sellerProducts = sellerProductsResult.map((item) => ({
      PRODUCT_ID: item.PRODUCT_ID,
      NAME: item.NAME,
      DESCRIPTION: item.DESCRIPTION,
      PRICE: item.PRICE, // Ensure PRICE is a number
      STOCK: item.STOCK,
      SELLER_ID: item.SELLER_ID,
    }));

    const responseData = {
      sellerProducts,
    };

    // Store in cache
    cache.set('all_seller_products', responseData);

    res.json(responseData);
  } catch (error) {
    logger.error('Error fetching all seller products:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   PUT /api/seller-products/:sellerProductId
 * @desc    Update a seller's product offering
 * @access  Private (Sellers only)
 */
router.put(
  '/:sellerProductId',
  authMiddleware,
  authorize(['seller']),
  [
    body('price').optional().isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
    body('stock').optional().isInt({ gt: -1 }).withMessage('Stock must be a non-negative integer'),
  ],
  async (req, res) => {
    const { sellerProductId } = req.params;
    const { price, stock } = req.body;
    const sellerId = req.user.id;

    try {
      // Verify the seller owns this offering
      const offeringResult = await db.execute({
        sqlText: `
          SELECT * FROM trade.gwtrade.SELLER_PRODUCTS
          WHERE SELLER_PRODUCT_ID = ? AND SELLER_ID = ?
        `,
        binds: [sellerProductId, sellerId],
      });

      if (offeringResult.length === 0) {
        return res.status(404).json({ message: 'Product offering not found' });
      }

      // Build dynamic update query
      const fields = [];
      const binds = [];

      if (price !== undefined) {
        fields.push('PRICE = ?');
        binds.push(price);
      }

      if (stock !== undefined) {
        fields.push('STOCK = ?');
        binds.push(stock);
      }

      if (fields.length === 0) {
        return res.status(400).json({ message: 'No fields to update' });
      }

      binds.push(sellerProductId); // For WHERE clause

      const updateSql = `
        UPDATE trade.gwtrade.SELLER_PRODUCTS
        SET ${fields.join(', ')}, UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE SELLER_PRODUCT_ID = ?
      `;

      await db.execute({
        sqlText: updateSql,
        binds,
      });

      logger.info(`Seller ${sellerId} updated product offering ${sellerProductId}`);
      res.json({ message: 'Product offering updated successfully' });
    } catch (error) {
      logger.error('Error updating product offering:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

/**
 * @route   DELETE /api/seller-products/:sellerProductId
 * @desc    Delete a seller's product offering
 * @access  Private (Sellers only)
 */
router.delete('/:sellerProductId', authMiddleware, authorize(['seller']), async (req, res) => {
  const { sellerProductId } = req.params;
  const sellerId = req.user.id;

  try {
    // Verify the seller owns this offering
    const offeringResult = await db.execute({
      sqlText: `
        SELECT * FROM trade.gwtrade.SELLER_PRODUCTS
        WHERE SELLER_PRODUCT_ID = ? AND SELLER_ID = ?
      `,
      binds: [sellerProductId, sellerId],
    });

    if (offeringResult.length === 0) {
      return res.status(404).json({ message: 'Product offering not found' });
    }

    // Delete the offering
    await db.execute({
      sqlText: `
        DELETE FROM trade.gwtrade.SELLER_PRODUCTS
        WHERE SELLER_PRODUCT_ID = ?
      `,
      binds: [sellerProductId],
    });

    logger.info(`Seller ${sellerId} deleted product offering ${sellerProductId}`);
    res.json({ message: 'Product offering deleted successfully' });
  } catch (error) {
    logger.error('Error deleting product offering:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
