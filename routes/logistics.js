const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { v4: uuidv4 } = require('uuid');
const redis = require('../config/redis');

const CACHE_EXPIRATION = 3600; // 1 hour

// Helper function to clear shipment cache
const clearShipmentCache = async (trackingNumber) => {
  try {
    await redis.del(`shipment_${trackingNumber}`);
    console.log('Shipment cache cleared for:', trackingNumber);
  } catch (error) {
    console.error('Error clearing shipment cache:', error);
  }
};

// POST: Create a new shipment
router.post('/shipments', authMiddleware, authorize(['seller']), async (req, res) => {
  const { buyer_id, status, tracking_number } = req.body;
  const seller_id = req.user.id;

  try {
    const shipment_id = uuidv4();
    await db.execute({
      sqlText: 'INSERT INTO trade.gwtrade.Shipments (shipment_id, seller_id, buyer_id, status, tracking_number) VALUES (?, ?, ?, ?, ?)',
      binds: [shipment_id, seller_id, buyer_id, status, tracking_number]
    });

    // Clear cache for this tracking number if it exists
    await clearShipmentCache(tracking_number);

    res.status(201).json({ message: 'Shipment created successfully', shipment_id });
  } catch (error) {
    console.error('Error creating shipment:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET: Fetch all shipments for a seller
router.get('/shipments', authMiddleware, authorize(['seller']), async (req, res) => {
  const seller_id = req.user.id;
  const cacheKey = `shipments_seller_${seller_id}`;

  try {
    // Try to get from cache first
    const cachedShipments = await redis.get(cacheKey);
    if (cachedShipments) {
      console.log('Serving shipments from cache');
      return res.json(JSON.parse(cachedShipments));
    }

    const shipments = await db.execute({
      sqlText: 'SELECT * FROM trade.gwtrade.Shipments WHERE seller_id = ?',
      binds: [seller_id]
    });

    // Cache the results
    await redis.setex(cacheKey, CACHE_EXPIRATION, JSON.stringify(shipments));
    console.log('Shipments cached for seller:', seller_id);

    res.json(shipments);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PUT: Update shipment status
router.put('/shipments/:id', async (req, res) => {
  const shipmentId = req.params.id;
  const { status } = req.body;

  try {
    const result = await db.execute({
      sqlText: `
          UPDATE trade.gwtrade.Shipments
          SET status = ?
          WHERE shipment_id = ?
        `,
      binds: [status, shipmentId]
    });

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    // Clear cache for this shipment
    const shipment = await db.execute({
      sqlText: 'SELECT tracking_number FROM trade.gwtrade.Shipments WHERE shipment_id = ?',
      binds: [shipmentId]
    });
    
    if (shipment && shipment[0]) {
      await clearShipmentCache(shipment[0].tracking_number);
    }

    res.status(200).json({ message: 'Shipment status updated successfully' });
  } catch (error) {
    console.error('Error updating shipment status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET: Track a shipment
router.get('/shipments/:trackingNumber', async (req, res) => {
  const { trackingNumber } = req.params;
  const cacheKey = `shipment_${trackingNumber}`;

  try {
    // Try to get from cache first
    const cachedShipment = await redis.get(cacheKey);
    if (cachedShipment) {
      console.log('Serving shipment from cache');
      return res.json(JSON.parse(cachedShipment));
    }

    const shipments = await db.execute({
      sqlText: 'SELECT STATUS, TRACKING_NUMBER, CREATED_AT, UPDATED_AT FROM trade.gwtrade.Shipments WHERE tracking_number = ?',
      binds: [trackingNumber]
    });

    if (!shipments || shipments.length === 0) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    // Cache the result for 15 minutes (since status can change frequently)
    await redis.setex(cacheKey, 900, JSON.stringify(shipments[0]));
    console.log('Shipment cached:', trackingNumber);

    res.json(shipments[0]);
  } catch (error) {
    console.error('Error tracking shipment:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
