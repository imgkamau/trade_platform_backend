// routes/buyers.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, verifyRole } = require('../middleware/auth');

// GET: Retrieve the buyer's profile
router.get('/profile', verifyToken, verifyRole(['buyer']), async (req, res) => {
  const buyerId = req.user.id;

  try {
    // Removed cache check - directly fetch from database
    const buyerResult = await db.execute({
      sqlText: `SELECT * FROM trade.gwtrade.BUYERS WHERE USER_ID = ?`,
      binds: [buyerId],
    });

    const buyerRows = buyerResult.rows || buyerResult;
    if (!buyerRows || buyerRows.length === 0) {
      return res.status(404).json({ message: 'Buyer profile not found.' });
    }

    const buyerProfile = buyerRows[0];

    // Fetch user details from USERS table
    const userResult = await db.execute({
      sqlText: `SELECT EMAIL, FULL_NAME FROM trade.gwtrade.USERS WHERE USER_ID = ?`,
      binds: [buyerId],
    });

    const userRows = userResult.rows || userResult;
    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const userDetails = userRows[0];

    // Combine buyer profile and user details
    const profileData = {
      user_id: buyerId,
      email: userDetails.EMAIL,
      full_name: userDetails.FULL_NAME,
      productInterests: buyerProfile.PRODUCT_INTERESTS || [],
      location: buyerProfile.LOCATION || '',
    };

    // Removed cache setting
    res.json({ profile: profileData });
  } catch (error) {
    console.error('Error fetching buyer profile:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// PUT: Update buyer's profile
router.put('/profile', verifyToken, verifyRole(['buyer']), async (req, res) => {
  const buyerId = req.user.id;
  const { productInterests, location } = req.body;

  if (!productInterests || !Array.isArray(productInterests)) {
    return res.status(400).json({ message: 'productInterests must be an array.' });
  }

  try {
    // Update the buyer's profile
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

    await db.execute({
      sqlText,
      binds,
    });

    // Removed cache clearing
    res.json({ message: 'Buyer profile updated successfully.' });
  } catch (error) {
    console.error('Error updating buyer profile:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// POST: Create initial buyer profile
router.post('/profile', verifyToken, verifyRole(['buyer']), async (req, res) => {
  const buyerId = req.user.id;

  try {
    // Check if profile already exists
    const existingProfile = await db.execute({
      sqlText: `SELECT USER_ID FROM trade.gwtrade.BUYERS WHERE USER_ID = ?`,
      binds: [buyerId],
    });

    if (existingProfile.rows && existingProfile.rows.length > 0) {
      return res.status(400).json({ message: 'Buyer profile already exists.' });
    }

    // Create initial profile using SELECT syntax that we know works
    await db.execute({
      sqlText: `
        INSERT INTO trade.gwtrade.BUYERS (
          USER_ID,
          PRODUCT_INTERESTS,
          LOCATION
        ) 
        SELECT ?, ARRAY_CONSTRUCT(''), ?
      `,
      binds: [buyerId, ''],
    });

    res.status(201).json({ 
      message: 'Buyer profile created successfully.',
      profile: {
        user_id: buyerId,
        productInterests: [],
        location: ''
      }
    });

  } catch (error) {
    console.error('Error creating buyer profile:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;
