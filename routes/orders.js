// routes/orders.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const Order = require('../models/Order'); // Import the correct Order model

// Place a new order (Buyers only)
router.post('/', authMiddleware, async (req, res) => {
  const { items } = req.body; // items is an array of { productId, quantity }
  const buyerId = req.user.id;
  const role = req.user.role;

  if (role !== 'buyer') {
    return res.status(403).json({ message: 'Only buyers can place orders' });
  }

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'Order items are required' });
  }

  try {
    let totalAmount = 0;
    const ORDER_ID = uuidv4();

    // Begin transaction
    await db.execute({ sqlText: 'BEGIN', binds: [] });

    for (const item of items) {
      const { productId, quantity } = item;

      // Fetch product details
      const productResult = await db.execute({
        sqlText: `SELECT * FROM PRODUCTS WHERE PRODUCT_ID = ?`,
        binds: [productId],
      });

      const product = productResult && productResult[0];

      if (!product) {
        throw new Error(`Product with ID ${productId} not found`);
      }

      if (product.QUANTITY < quantity) {
        throw new Error(`Insufficient quantity for product ${product.NAME}`);
      }

      const itemTotal = product.PRICE * quantity;
      totalAmount += itemTotal;

      await db.execute({
        sqlText: `UPDATE PRODUCTS SET STOCK = STOCK - ? WHERE PRODUCT_ID = ?`,
        binds: [quantity, productId],
      });

      // Insert order item
      const ORDER_ITEM_ID = uuidv4();
      await db.execute({
        sqlText: `INSERT INTO ORDER_ITEMS (
          ORDER_ITEM_ID,
          ORDER_ID,
          PRODUCT_ID,
          QUANTITY,
          PRICE
        ) VALUES (?, ?, ?, ?, ?)`,
        binds: [ORDER_ITEM_ID, ORDER_ID, productId, quantity, product.PRICE],
      });
    }

    // Create order
    await db.execute({
      sqlText: `INSERT INTO ORDERS (
        ORDER_ID,
        BUYER_ID,
        TOTAL_AMOUNT
      ) VALUES (?, ?, ?)`,
      binds: [ORDER_ID, buyerId, totalAmount],
    });

    // Commit transaction
    await db.execute({ sqlText: 'COMMIT', binds: [] });

    res.status(201).json({ message: 'Order placed successfully', orderId: ORDER_ID });
  } catch (error) {
    console.error('Error placing order:', error);
    // Rollback transaction
    await db.execute({ sqlText: 'ROLLBACK', binds: [] });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET all orders
router.get('/', async (req, res) => {
  try {
    const orders = await Order.find(); // This will now fetch orders from the correct model
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;