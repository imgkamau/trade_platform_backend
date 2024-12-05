// routes/matchmaking.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth'); // Middleware that sets req.user.id and req.user.role
const userModel = require('../models/userModel');
const matchmaking = require('../utils/matchmaking');

router.get('/matchmaking', authMiddleware, async (req, res) => {
  const buyerId = req.user.id;

  // Ensure the user is a buyer
  if (req.user.role !== 'buyer') {
    return res.status(403).json({ message: 'Access denied. Only buyers can access matchmaking.' });
  }

  try {
    // Fetch buyer's profile
    const buyer = await userModel.getBuyerProfile(buyerId);
    if (!buyer) {
      return res.status(404).json({ message: 'Buyer profile not found' });
    }

    // Use the matchmaking function
    const matches = await matchmaking.findMatches(buyer, db);

    res.json({ matches });
  } catch (error) {
    console.error('Error during matchmaking:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;
