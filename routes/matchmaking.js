// routes/matchmaking.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth'); // Middleware that sets req.user.id and req.user.role
const userModel = require('../models/userModel');
// Import findMatches function
const findMatches = require('../utils/matchmaking');

router.get('/matchmaking', authMiddleware, async (req, res) => {
  console.log('Matchmaking endpoint called');
  const buyerId = req.user.id;

  // Ensure the user is a buyer
  if (req.user.role !== 'buyer') {
    console.log('User is not a buyer');
    return res.status(403).json({ message: 'Access denied. Only buyers can access matchmaking.' });
  }

  try {
    console.log('Fetching buyer profile');
    // Fetch buyer's profile
    const buyer = await userModel.getBuyerProfile(buyerId);
    if (!buyer) {
      console.log('Buyer profile not found');
      return res.status(404).json({ message: 'Buyer profile not found' });
    }

    console.log('Running matchmaking function');
    // Use the findMatches function
    const matches = await findMatches(buyer, db);
    console.log('Matchmaking function completed');

    res.json({ matches });
  } catch (error) {
    console.error('Error during matchmaking:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;
