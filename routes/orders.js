// routes/orders.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Snowflake database module
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');

// Place a new order (Buyers only)
router.post('/', authMiddleware, async (req, res) => {
  const { items } = req.body; // items is an array of { productName, quantity }
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
      const { productName, quantity } = item;

      console.log('Processing item:', item);
      console.log('Product Name:', productName);
      console.log('Quantity:', quantity);

      // Validate productName and quantity
      if (!productName || typeof productName !== 'string') {
        throw new Error('Invalid product name');
      }
      if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('Invalid quantity');
      }

      // Fetch product details using product name
      const productResult = await db.execute({
        sqlText: `SELECT * FROM PRODUCTS WHERE NAME = ?`,
        binds: [productName],
      });

      console.log('Product Result:', productResult);

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

      console.log('Product ID:', productId);

      if (product.STOCK < quantity) {
        throw new Error(`Insufficient stock for product ${product.NAME}`);
      }

      const itemTotal = product.PRICE * quantity;
      totalAmount += itemTotal;

      console.log('Updating product stock...');
      console.log('Quantity:', quantity);
      console.log('Product ID:', productId);

      // Update product stock
      await db.execute({
        sqlText: `UPDATE PRODUCTS SET STOCK = STOCK - ? WHERE PRODUCT_ID = ?`,
        binds: [quantity, productId],
      });

      // Insert order item
      const ORDER_ITEM_ID = uuidv4();
      console.log('Inserting order item...');
      console.log('ORDER_ITEM_ID:', ORDER_ITEM_ID);
      console.log('ORDER_ID:', ORDER_ID);
      console.log('Product ID:', productId);
      console.log('Product Name:', productName);
      console.log('Quantity:', quantity);
      console.log('Price:', product.PRICE);

      await db.execute({
        sqlText: `
          INSERT INTO ORDER_ITEMS (
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
    }

    console.log('Creating order...');
    console.log('ORDER_ID:', ORDER_ID);
    console.log('Buyer ID:', buyerId);
    console.log('Total Amount:', totalAmount);

    // Create order
    await db.execute({
      sqlText: `
        INSERT INTO ORDERS (
          ORDER_ID,
          BUYER_ID,
          TOTAL_AMOUNT,
          CREATED_AT
        ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `,
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
    const orders = await db.execute({
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
        FROM ORDERS o
        JOIN ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
        JOIN PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
        ORDER BY o.CREATED_AT DESC
      `,
      binds: [],
    });

    // Format the orders as needed
    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
