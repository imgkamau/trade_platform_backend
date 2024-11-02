const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { v4: uuidv4 } = require('uuid'); // Import the uuid module

// Log to confirm the router is loaded
console.log('Logistics router loaded');

// POST: Create a new shipment
router.post('/shipments', authMiddleware, authorize(['seller']), async (req, res) => {
    const { buyer_id, status, tracking_number } = req.body;
    const seller_id = req.user.id;

    try {
        const shipment_id = uuidv4(); // Generate a unique ID
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
router.get('/shipments', authMiddleware, authorize(['seller']), async (req, res) => {
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

// Additional routes can be added for tracking, document management, etc.
// Modify existing shipment status
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
  
      res.status(200).json({ message: 'Shipment status updated successfully' });
    } catch (error) {
      console.error('Error updating shipment status:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
  
module.exports = router;
