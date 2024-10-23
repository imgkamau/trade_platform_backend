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

// Update a product (Exporters only)
router.put('/:productId', authMiddleware, authorize(['exporter']), async (req, res) => {
  const { productId } = req.params;
  const { name, description, category, price, quantity } = req.body;
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

    // Update the product
    await db.execute({
      sqlText: `UPDATE PRODUCTS SET
        NAME = COALESCE(?, NAME),
        DESCRIPTION = COALESCE(?, DESCRIPTION),
        CATEGORY = COALESCE(?, CATEGORY),
        PRICE = COALESCE(?, PRICE),
        QUANTITY = COALESCE(?, QUANTITY),
        UPDATED_AT = CURRENT_TIMESTAMP
        WHERE PRODUCT_ID = ?`,
      binds: [name, description, category, price, quantity, productId],
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
