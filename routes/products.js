// routes/products.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid'); // Import the uuid module

// Authentication and Authorization middleware
const authMiddleware = require('../middleware/auth'); // Authentication middleware
const authorize = require('../middleware/authorize'); // Authorization middleware

// Optional: Caching (if needed)
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

// GET /api/products - Public 
router.get('/', async (req, res) => {
  console.log('Received GET request to /api/products');

  const getCurrentDbSchemaSql = 'SELECT CURRENT_DATABASE(), CURRENT_SCHEMA()';
  console.log('Executing SQL query:', getCurrentDbSchemaSql);

  try {
    // Fetch current database and schema
    const dbSchemaRows = await db.execute({ sqlText: getCurrentDbSchemaSql });
    const currentDb = dbSchemaRows[0].CURRENT_DATABASE;
    const currentSchema = dbSchemaRows[0].CURRENT_SCHEMA;
    console.log(`Current Database: ${currentDb}, Current Schema: ${currentSchema}`);

    const sql = 'SELECT * FROM trade.gwtrade.PRODUCTS'; // Fully qualified table name
    console.log('Executing SQL query:', sql);

    const rows = await db.execute({ sqlText: sql });
    
    console.log(`Fetched ${rows ? rows.length : 0} products from the database`);
    
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'No products found' });
    }
    
    res.json(rows);
  } catch (error) {
    console.error('Error in GET /api/products:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET: Retrieve products for the authenticated seller
router.get('/seller', authMiddleware, authorize(['seller']), async (req, res) => {
  logger.info('Entered GET /api/products/seller route');

  try {
    const sellerId = req.user.id; // Assuming the seller's ID is stored in req.user.id
    logger.info(`Fetching products for seller ID: ${sellerId}`);

    const products = await db.execute({
      sqlText: `
        SELECT 
          PRODUCT_ID,
          NAME,
          DESCRIPTION,
          PRICE,
          STOCK,
          CATEGORY,
          UPDATED_AT
        FROM trade.gwtrade.Products
        WHERE SELLER_ID = ?
        ORDER BY UPDATED_AT DESC
      `,
      binds: [sellerId],
    });

    logger.info(`Fetched ${products.length} products for seller ID: ${sellerId}`);
    res.json(products);
  } catch (error) {
    logger.error('Error fetching seller products:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
});

// POST /api/products - Create a new product (Sellers only)
router.post('/', authMiddleware, authorize(['seller']), async (req, res) => {
  const { NAME, DESCRIPTION, PRICE, STOCK } = req.body;
  const SELLER_ID = req.user.id; // Get SELLER_ID from the authenticated user

  // Validate input
  if (!NAME || !DESCRIPTION || !PRICE || !STOCK) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const PRODUCT_ID = uuidv4(); // Generate a unique ID for the product

    // Insert the new product into the database
    await db.execute({
      sqlText: `
        INSERT INTO trade.gwtrade.PRODUCTS (PRODUCT_ID, NAME, DESCRIPTION, PRICE, STOCK, SELLER_ID)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      binds: [PRODUCT_ID, NAME, DESCRIPTION, PRICE, STOCK, SELLER_ID],
    });

    res.status(201).json({ message: 'Product created successfully' });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update a product (Sellers only)
router.put('/:productId', authMiddleware, authorize(['seller']), async (req, res) => {
  const { productId } = req.params;
  const { name, description, category, price, stock } = req.body;
  const sellerId = req.user.id;

  try {
    // Check if the product exists and belongs to the seller
    const productResult = await db.execute({
      sqlText: `SELECT * FROM trade.gwtrade.PRODUCTS WHERE PRODUCT_ID = ? AND SELLER_ID = ?`,
      binds: [productId, sellerId],
    });

    if (!productResult || productResult.length === 0) {
      return res.status(404).json({ message: 'Product not found or access denied' });
    }

    // Replace undefined with null in binds array
    const binds = [name ?? null, description ?? null, category ?? null, price ?? null, stock ?? null, productId];

    // Update the product
    await db.execute({
      sqlText: `UPDATE trade.gwtrade.PRODUCTS SET
        NAME = COALESCE(?, NAME),
        DESCRIPTION = COALESCE(?, DESCRIPTION),
        CATEGORY = COALESCE(?, CATEGORY),
        PRICE = COALESCE(?, PRICE),
        STOCK = COALESCE(?, STOCK),
        UPDATED_AT = CURRENT_TIMESTAMP
        WHERE PRODUCT_ID = ?`,
      binds: binds,
    });

    res.json({ message: 'Product updated successfully' });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a product (Exporters only)
router.delete('/:productId', authMiddleware, authorize(['exporter']), async (req, res) => {
  const { productId } = req.params;
  const sellerId = req.user.id;

  try {
    // Check if the product exists and belongs to the seller
    const productResult = await db.execute({
      sqlText: `SELECT * FROM trade.gwtrade.PRODUCTS WHERE PRODUCT_ID = ? AND SELLER_ID = ?`,
      binds: [productId, sellerId],
    });

    if (!productResult || productResult.length === 0) {
      return res.status(404).json({ message: 'Product not found or access denied' });
    }

    // Delete the product
    await db.execute({
      sqlText: `DELETE FROM trade.gwtrade.PRODUCTS WHERE PRODUCT_ID = ?`,
      binds: [productId],
    });

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Public Route: Get Sellers for a Specific Product
router.get('/:productId/sellers', async (req, res) => { // Removed authMiddleware and authorize
  const { productId } = req.params;
  logger.info(`Fetching sellers for product ID: ${productId}`);

  try {
    // Verify if the product exists
    const productResult = await db.execute({
      sqlText: `
        SELECT 
          PRODUCT_ID,
          NAME,
          DESCRIPTION,
          CATEGORY
        FROM trade.gwtrade.PRODUCTS
        WHERE PRODUCT_ID = ?
      `,
      binds: [productId],
    });

    if (productResult.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Optional: Check cache first
    const cachedData = cache.get(`product_sellers_${productId}`);
    if (cachedData) {
      logger.info(`Cache hit for product ID: ${productId}`);
      return res.json(cachedData);
    }

    // Fetch sellers offering this product
    const sellersResult = await db.execute({
      sqlText: `
        SELECT 
          sp.SELLER_PRODUCT_ID,
          u.USER_ID AS SELLER_ID,
          u.FULL_NAME AS SELLER_NAME,
          u.COMPANY_NAME,
          u.COMPANY_DESCRIPTION,
          u.PHONE_NUMBER,
          u.ADDRESS,
          sp.PRICE,
          sp.STOCK
        FROM trade.gwtrade.SELLER_PRODUCTS sp
        JOIN trade.gwtrade.USERS u ON sp.SELLER_ID = u.USER_ID
        WHERE sp.PRODUCT_ID = ?
        ORDER BY sp.PRICE ASC
      `,
      binds: [productId],
    });

    // Format the sellers' data
    const sellers = sellersResult.map((seller) => ({
      id: seller.SELLER_ID,
      name: seller.SELLER_NAME,
      companyName: seller.COMPANY_NAME,
      companyDescription: seller.COMPANY_DESCRIPTION,
      phoneNumber: seller.PHONE_NUMBER,
      address: seller.ADDRESS,
      price: `$${seller.PRICE.toFixed(2)}/kg`,
      stock: seller.STOCK,
    }));

    const responseData = {
      product: productResult[0],
      sellers,
    };

    // Store in cache
    cache.set(`product_sellers_${productId}`, responseData);

    res.json(responseData);
  } catch (error) {
    logger.error('Error fetching sellers for product:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
