// routes/products.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid'); // Import the uuid module
//const redis = require('../config/redis');
const CACHE_EXPIRATION = 3600; // 1 hour in seconds
const { verifyToken, verifyRole } = require('../middleware/auth'); // New auth middleware

// Optional: Caching (if needed)
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

// GET /api/products - Public 
router.get('/', async (req, res) => {
  const startTime = Date.now();
  console.log('=== START: GET /api/products ===');
  console.log('Time:', new Date().toISOString());

  try {
    // Try to get from cache first
    let cachedProducts;
    try {
      cachedProducts = await redis.get('all_products');
      if (cachedProducts) {
        console.log('Cache hit! Serving from Redis');
        return res.json(JSON.parse(cachedProducts));
      }
      console.log('Cache miss, querying database');
    } catch (cacheError) {
      console.log('Cache error, falling back to database:', cacheError.message);
    }

    // Database query
    const sql = `
      SELECT 
        p.PRODUCT_ID,
        p.NAME,
        p.DESCRIPTION,
        p.PRICE,
        p.STOCK,
        p.CATEGORY,
        p.UPDATED_AT,
        p.SELLER_ID,
        u.FULL_NAME AS SELLER_NAME
      FROM trade.gwtrade.PRODUCTS p
      LEFT JOIN trade.gwtrade.USERS u ON p.SELLER_ID = u.USER_ID
      WHERE u.ROLE = 'seller'
    `;

    console.log('Executing database query...');
    const rows = await db.execute({ sqlText: sql });
    
    // Store in Redis cache
    try {
      await redis.setex('all_products', 3600, JSON.stringify(rows)); // Cache for 1 hour
      console.log('Successfully cached products');
    } catch (cacheError) {
      console.error('Failed to cache products:', cacheError.message);
    }
    
    const duration = Date.now() - startTime;
    console.log(`Request completed in ${duration}ms`);
    console.log(`Returning ${rows?.length || 0} products`);
    console.log('=== END: GET /api/products ===');
    
    res.json(rows || []);

  } catch (error) {
    console.error('Error in GET /api/products:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Clear cache when products are modified
const clearProductCache = async () => {
  try {
    await redis.del('all_products');
    console.log('Product cache cleared');
  } catch (error) {
    console.error('Error clearing product cache:', error);
  }
};

// GET: Retrieve products for the authenticated seller
router.get('/seller', verifyToken, verifyRole(['seller']), async (req, res) => {
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
router.post(
  '/',
  verifyToken,
  verifyRole(['seller']),
  [
    // Validation middleware (optional but recommended)
    body('NAME').notEmpty().withMessage('Product name is required'),
    body('DESCRIPTION').notEmpty().withMessage('Description is required'),
    body('PRICE').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
    body('STOCK').isInt({ gt: -1 }).withMessage('Stock must be a non-negative integer'),
    body('CATEGORY').optional().isString().withMessage('Category must be a string'),
  ],
  async (req, res) => {
    // Handle validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { NAME, DESCRIPTION, PRICE, STOCK, CATEGORY } = req.body;
    const SELLER_ID = req.user.id; // Get SELLER_ID from the authenticated user

    try {
      // Fetch SELLER_NAME from the USERS table
      const sellerResult = await db.execute({
        sqlText: `SELECT FULL_NAME FROM trade.gwtrade.USERS WHERE USER_ID = ? AND ROLE = 'seller'`,
        binds: [SELLER_ID],
      });

      if (!sellerResult || sellerResult.length === 0) {
        return res.status(404).json({ message: 'Seller not found' });
      }

      const SELLER_NAME = sellerResult[0].FULL_NAME;

      const PRODUCT_ID = uuidv4(); // Generate a unique ID for the product

      // Insert the new product into the database, including SELLER_NAME
      await db.execute({
        sqlText: `
          INSERT INTO trade.gwtrade.PRODUCTS (
            PRODUCT_ID,
            NAME,
            DESCRIPTION,
            PRICE,
            STOCK,
            SELLER_ID,
            SELLER_NAME,
            CATEGORY,
            UPDATED_AT
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP())
        `,
        binds: [
          PRODUCT_ID,
          NAME,
          DESCRIPTION,
          PRICE,
          STOCK,
          SELLER_ID,
          SELLER_NAME,
          CATEGORY || null, // Handle optional CATEGORY
        ],
      });

      // Log activity for the seller
      const logActivity = require('../utils/activityLogger');
      await logActivity(SELLER_ID, `Posted new product "${NAME}"`, 'other');

      // Clear cache after successful creation
      await clearProductCache();
      
      res.status(201).json({ message: 'Product created successfully', productId: PRODUCT_ID });
    } catch (error) {
      console.error('Error creating product:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// Update a product (Sellers only)
router.put('/:productId', verifyToken, verifyRole(['seller']), async (req, res) => {
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

    await clearProductCache();
    res.json({ message: 'Product updated successfully' });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a product (Exporters only)
router.delete('/:productId', verifyToken, verifyRole(['seller']), async (req, res) => {
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

    await clearProductCache();
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /api/products/:productId - Get a single product
router.get('/:productId', async (req, res) => {
  const { productId } = req.params;
  logger.info(`Fetching product details for ID: ${productId}`);
   try {
    const productResult = await db.execute({
      sqlText: `
        SELECT 
          p.PRODUCT_ID,
          p.NAME,
          p.DESCRIPTION,
          p.PRICE,
          p.CATEGORY,
          p.SELLER_ID,
          u.FULL_NAME AS SELLER_NAME
        FROM trade.gwtrade.PRODUCTS p
        LEFT JOIN trade.gwtrade.USERS u ON p.SELLER_ID = u.USER_ID
        WHERE p.PRODUCT_ID = ?
      `,
      binds: [productId],
    });
     if (!productResult || productResult.length === 0) {
      logger.warn(`Product not found with ID: ${productId}`);
      return res.status(404).json({ message: 'Product not found' });
    }
     res.json(productResult[0]);
  } catch (error) {
    logger.error(`Error fetching product ${productId}:`, error);
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
