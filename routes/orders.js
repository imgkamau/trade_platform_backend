// routes/orders.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Snowflake database module
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');
const logActivity = require('../utils/activityLogger');

// Place a new order (Buyers only)
router.post('/', authMiddleware, async (req, res) => {
  const { items } = req.body; // items is an array of { productName, quantity }
  const buyerId = req.user.id;
  const role = req.user.role;

  if (role !== 'buyer') {
    return res.status(403).json({ message: 'Only buyers can place orders' });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Order items are required' });
  }

  try {
    let totalAmount = 0;
    const ORDER_ID = uuidv4();

    // Begin transaction
    await db.execute({ sqlText: 'BEGIN', binds: [] });

    // To collect unique seller-product pairs
    const sellerProductMap = new Map();

    for (const item of items) {
      const { productName, quantity } = item;

      // Validate productName and quantity
      if (!productName || typeof productName !== 'string') {
        throw new Error('Invalid product name');
      }
      if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('Invalid quantity');
      }

      // Fetch product details using product name
      const productResult = await db.execute({
        sqlText: `SELECT * FROM trade.gwtrade.PRODUCTS WHERE NAME = ?`,
        binds: [productName],
      });

      if (!productResult || productResult.length === 0) {
        throw new Error(`Product with name "${productName}" not found`);
      }

      // Handle multiple products with the same name
      if (productResult.length > 1) {
        throw new Error(
          `Multiple products found with name "${productName}". Please specify further.`
        );
      }

      const product = productResult[0];
      const productId = product.PRODUCT_ID;
      const sellerId = product.SELLER_ID;

      if (product.STOCK < quantity) {
        throw new Error(`Insufficient stock for product ${product.NAME}`);
      }

      const itemTotal = product.PRICE * quantity;
      totalAmount += itemTotal;

      // Update product stock
      await db.execute({
        sqlText: `UPDATE trade.gwtrade.PRODUCTS SET STOCK = STOCK - ? WHERE PRODUCT_ID = ?`,
        binds: [quantity, productId],
      });

      // Insert order item
      const ORDER_ITEM_ID = uuidv4();

      await db.execute({
        sqlText: `
          INSERT INTO trade.gwtrade.ORDER_ITEMS (
            ORDER_ITEM_ID,
            ORDER_ID,
            PRODUCT_ID,
            PRODUCT_NAME,
            QUANTITY,
            PRICE
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
        binds: [ORDER_ITEM_ID, ORDER_ID, productId, productName, quantity, product.PRICE],
      });

      // Collect seller-product pair for conversation creation
      const key = `${sellerId}-${productId}`;
      if (!sellerProductMap.has(key)) {
        sellerProductMap.set(key, { sellerId, productId });
      }
    }

    // Create order
    await db.execute({
      sqlText: `
        INSERT INTO trade.gwtrade.ORDERS (
          ORDER_ID,
          BUYER_ID,
          TOTAL_AMOUNT,
          CREATED_AT
        ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `,
      binds: [ORDER_ID, buyerId, totalAmount],
    });

    // Automatically create conversations between buyer and each seller for the products
    for (const [key, { sellerId, productId }] of sellerProductMap.entries()) {
      // Check if a conversation already exists
      const existingConversation = await db.execute({
        sqlText: `
          SELECT CONVERSATION_ID FROM trade.gwtrade.CONVERSATIONS
          WHERE SELLER_ID = ? AND BUYER_ID = ? AND PRODUCT_ID = ?
          LIMIT 1
        `,
        binds: [sellerId, buyerId, productId],
      });

      if (existingConversation && existingConversation.length > 0) {
        continue; // Skip creating a new conversation
      }

      // Create new conversation
      const conversationId = uuidv4();
      await db.execute({
        sqlText: `
          INSERT INTO trade.gwtrade.CONVERSATIONS (CONVERSATION_ID, SELLER_ID, BUYER_ID, PRODUCT_ID)
          VALUES (?, ?, ?, ?)
        `,
        binds: [conversationId, sellerId, buyerId, productId],
      });
    }

    // Commit transaction
    await db.execute({ sqlText: 'COMMIT', binds: [] });

    res.status(201).json({ message: 'Order placed successfully', orderId: ORDER_ID });
    await logActivity(req.user.id, 'New order received', 'order');
  } catch (error) {
    console.error('Error placing order:', error);
    // Rollback transaction
    await db.execute({ sqlText: 'ROLLBACK', binds: [] });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET all orders
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;

  try {
    // Fetch orders based on user role
    let orders;
    if (role === 'buyer') {
      // Buyers fetch their own orders
      orders = await db.execute({
        sqlText: `
          SELECT 
            o.ORDER_ID,
            o.BUYER_ID,
            o.TOTAL_AMOUNT,
            o.CREATED_AT,
            oi.ORDER_ITEM_ID,
            oi.PRODUCT_ID,
            oi.QUANTITY,
            oi.PRICE,
            p.NAME AS PRODUCT_NAME
          FROM trade.gwtrade.ORDERS o
          JOIN trade.gwtrade.ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
          JOIN trade.gwtrade.PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
          WHERE o.BUYER_ID = ?
          ORDER BY o.CREATED_AT DESC
        `,
        binds: [userId],
      });
    } else if (role === 'seller') {
      // Sellers fetch orders containing their products
      orders = await db.execute({
        sqlText: `
          SELECT 
            o.ORDER_ID,
            o.BUYER_ID,
            u.FULL_NAME AS BUYER_NAME,
            o.TOTAL_AMOUNT,
            o.CREATED_AT,
            oi.ORDER_ITEM_ID,
            oi.PRODUCT_ID,
            oi.QUANTITY,
            oi.PRICE,
            p.NAME AS PRODUCT_NAME
          FROM trade.gwtrade.ORDERS o
          JOIN trade.gwtrade.ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
          JOIN trade.gwtrade.PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
          JOIN trade.gwtrade.USERS u ON o.BUYER_ID = u.USER_ID
          WHERE p.SELLER_ID = ?
          ORDER BY o.CREATED_AT DESC
        `,
        binds: [userId],
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Format the orders as needed
    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
