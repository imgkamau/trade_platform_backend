// routes/products.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid'); // Import the uuid module

// Authentication and Authorization middleware
const authMiddleware = require('../middleware/auth'); // Authentication middleware
const authorize = require('../middleware/authorize'); // Authorization middleware

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

// POST /api/products - Create a new product (Sellers only)
router.post('/', authMiddleware, authorize(['seller']), async (req, res) => {
  const { NAME, DESCRIPTION, PRICE, STOCK, SELLER_ID } = req.body;
  const sellerId = req.user.id; // Get seller ID from req.user

  // Validate input
  if (!NAME || !DESCRIPTION || !PRICE || !STOCK || !SELLER_ID) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const productId = uuidv4(); // Generate a unique ID for the product

    // Insert the new product into the database
    await db.execute({
      sqlText: `INSERT INTO PRODUCTS (PRODUCT_ID, NAME, DESCRIPTION, PRICE, STOCK, SELLER_ID) VALUES (?, ?, ?, ?, ?, ?)`,
      binds: [productId, NAME, DESCRIPTION, PRICE, STOCK, sellerId],
    });

    res.status(201).json({ message: 'Product created successfully' });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update a product (Exporters only)
// Update a product (Sellers only)
router.put('/:productId', authMiddleware, authorize(['seller']), async (req, res) => {
  const { productId } = req.params;
  const { name, description, category, price, stock } = req.body;
  const sellerId = req.user.id;

  try {
    // Check if the product exists and belongs to the seller
    const productResult = await db.execute({
      sqlText: `SELECT * FROM PRODUCTS WHERE PRODUCT_ID = ? AND SELLER_ID = ?`,
      binds: [productId, sellerId],
    });

    if (!productResult || productResult.length === 0) {
      return res.status(404).json({ message: 'Product not found or access denied' });
    }

    // Replace undefined with null in binds array
    const binds = [name ?? null, description ?? null, category ?? null, price ?? null, stock ?? null, productId];

    // Update the product
    await db.execute({
      sqlText: `UPDATE PRODUCTS SET
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
      sqlText: `SELECT * FROM PRODUCTS WHERE PRODUCT_ID = ? AND SELLER_ID = ?`,
      binds: [productId, sellerId],
    });

    if (!productResult || productResult.length === 0) {
      return res.status(404).json({ message: 'Product not found or access denied' });
    }

    // Delete the product
    await db.execute({
      sqlText: `DELETE FROM PRODUCTS WHERE PRODUCT_ID = ?`,
      binds: [productId],
    });

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
