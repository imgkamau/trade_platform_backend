// routes/buyers.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// PUT: Update buyer's product interests
router.put('/profile', authMiddleware, async (req, res) => {
  const buyerId = req.user.id;

  // Ensure the user is a buyer
  if (req.user.role !== 'buyer') {
    return res.status(403).json({ message: 'Access denied. Only buyers can update their profile.' });
  }

  const { productInterests, location } = req.body;

  if (!productInterests || !Array.isArray(productInterests)) {
    return res.status(400).json({ message: 'productInterests must be an array.' });
  }

  try {
    // Update the buyer's product interests and location (if provided)
    const updateFields = [];
    const binds = [];
    let bindIndex = 1;

    if (productInterests) {
      updateFields.push(`PRODUCT_INTERESTS = PARSE_JSON(?)`);
      binds.push(JSON.stringify(productInterests));
      bindIndex++;
    }

    if (location) {
      updateFields.push(`LOCATION = ?`);
      binds.push(location);
      bindIndex++;
    }

    const sqlText = `
      UPDATE trade.gwtrade.buyers
      SET ${updateFields.join(', ')}
      WHERE USER_ID = ?
    `;

    binds.push(buyerId);

    const result = await db.execute({
      sqlText,
      binds,
    });

    res.json({ message: 'Buyer profile updated successfully.' });
  } catch (error) {
    console.error('Error updating buyer profile:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;
