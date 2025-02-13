// routes/orders.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Snowflake database module
const { v4: uuidv4 } = require('uuid');
const { verifyToken, verifyRole } = require('../middleware/auth');
const logger = require('../utils/logger');
const logActivity = require('../utils/activityLogger');
//const redis = require('../config/redis');

const CACHE_EXPIRATION = 3600; // 1 hour
const CONVERSATIONS_LIMIT = 50; // Example limit for recent activities

// Apply auth middleware to all routes
router.use(verifyToken);

// GET all orders with caching
router.get('/', verifyRole(['seller', 'buyer']), async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  const cacheKey = `orders_${role}_${userId}`;

  try {
    // Try cache first
    const cachedOrders = await redis.get(cacheKey);
    if (cachedOrders) {
      console.log('Serving orders from cache');
      return res.json(JSON.parse(cachedOrders));
    }

    // If not in cache, fetch from database
    let orders;
    if (role === 'buyer') {
      orders = await db.execute({
        sqlText: `
          SELECT 
            o.ORDER_ID,
            o.BUYER_ID,
            o.TOTAL_AMOUNT,
            o.STATUS,
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
      orders = await db.execute({
        sqlText: `
          SELECT 
            o.ORDER_ID,
            o.BUYER_ID,
            u.FULL_NAME AS BUYER_NAME,
            o.TOTAL_AMOUNT,
            o.STATUS,
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

    // Cache the results
    await redis.setex(cacheKey, CACHE_EXPIRATION, JSON.stringify(orders));
    console.log(`Cached orders for ${role} ${userId}`);

    res.status(200).json(orders);
  } catch (error) {
    logger.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// Clear cache helper
const clearOrderCache = async (buyerId, sellerIds) => {
  try {
    // Clear buyer's cache
    await redis.del(`orders_buyer_${buyerId}`);
    
    // Clear sellers' cache
    for (const sellerId of sellerIds) {
      await redis.del(`orders_seller_${sellerId}`);
    }
    console.log('Order caches cleared');
  } catch (error) {
    console.error('Error clearing order cache:', error);
  }
};

// Place a new order (Buyers only)
router.post('/', verifyRole(['buyer']), async (req, res) => {
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
    const sellersSet = new Set(); // To collect unique seller IDs

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
        throw new Error(`Insufficient stock for product "${product.NAME}"`);
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
        sellersSet.add(sellerId); // Add to sellers set
      }
    }

    // Create order
    await db.execute({
      sqlText: `
        INSERT INTO trade.gwtrade.ORDERS (
          ORDER_ID,
          BUYER_ID,
          TOTAL_AMOUNT,
          STATUS,
          CREATED_AT
        ) VALUES (?, ?, ?, 'Pending', CURRENT_TIMESTAMP)
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

    // Log activities for each unique seller
    for (const sellerId of sellersSet) {
      await logActivity(sellerId, 'New order received', 'order');
    }

    // After successful order creation, clear caches
    await clearOrderCache(buyerId, Array.from(sellersSet));
    
    // Send response to the client
    res.status(201).json({ message: 'Order placed successfully', orderId: ORDER_ID });
  } catch (error) {
    console.error('Error placing order:', error);
    // Rollback transaction
    await db.execute({ sqlText: 'ROLLBACK', binds: [] });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
