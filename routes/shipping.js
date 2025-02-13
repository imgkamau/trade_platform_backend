// routes/shipping.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, verifyRole } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// POST: Get shipping quote
router.post('/quote', async (req, res) => {
  const { weight, dimensions, origin, destination } = req.body;

  try {
    // Here you would integrate with a shipping provider API to get real-time quotes
    // For demo purposes, we will return a mock response

    const mockQuote = {
      carrier: 'Carrier Name',
      cost: (weight * 0.5 + dimensions.volume * 0.1).toFixed(2), // Sample calculation
      deliveryTime: '3-5 business days',
    };

    res.json(mockQuote);
  } catch (error) {
    console.error('Error getting shipping quote:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST: Compare shipping costs (add multiple carriers' APIs in real implementation)
router.post('/compare', async (req, res) => {
  const { shipments } = req.body; // Array of shipment details

  try {
    // Mocking comparison for two carriers
    const quotes = shipments.map((shipment) => ({
      shipment,
      carrier1: { cost: 10, deliveryTime: '2 days' },
      carrier2: { cost: 15, deliveryTime: '3 days' },
    }));

    res.json(quotes);
  } catch (error) {
    console.error('Error comparing shipping costs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST: Create a new shipment
router.post('/shipments', verifyToken, verifyRole(['seller']), async (req, res) => {
  const { buyer_id, status, tracking_number } = req.body;
  const seller_id = req.user.id;

  try {
    const shipment_id = uuidv4();
    await db.execute({
      sqlText: 'INSERT INTO trade.gwtrade.Shipments (shipment_id, seller_id, buyer_id, status, tracking_number) VALUES (?, ?, ?, ?, ?)',
      binds: [shipment_id, seller_id, buyer_id, status, tracking_number]
    });

    res.status(201).json({ message: 'Shipment created successfully', shipment_id });
  } catch (error) {
    console.error('Error creating shipment:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET: Fetch all shipments for a seller
router.get('/shipments', verifyToken, verifyRole(['seller']), async (req, res) => {
  const seller_id = req.user.id;

  try {
    const shipments = await db.execute({
      sqlText: 'SELECT * FROM trade.gwtrade.Shipments WHERE seller_id = ?',
      binds: [seller_id]
    });

    res.json(shipments);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PUT: Update shipment status
router.put('/shipments/:id', verifyToken, verifyRole(['seller']), async (req, res) => {
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

    res.status(200).json({ message: 'Shipment status updated successfully' });
  } catch (error) {
    console.error('Error updating shipment status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET: Track a shipment
router.get('/shipments/:trackingNumber', async (req, res) => {
  const { trackingNumber } = req.params;

  try {
    const shipments = await db.execute({
      sqlText: 'SELECT STATUS, TRACKING_NUMBER, CREATED_AT, UPDATED_AT FROM trade.gwtrade.Shipments WHERE tracking_number = ?',
      binds: [trackingNumber]
    });

    if (!shipments || shipments.length === 0) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    res.json(shipments[0]);
  } catch (error) {
    console.error('Error tracking shipment:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
