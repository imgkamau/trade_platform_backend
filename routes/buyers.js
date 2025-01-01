// routes/buyers.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const redis = require('../config/redis');

const CACHE_EXPIRATION = 3600; // 1 hour

// Helper function to clear buyer cache
const clearBuyerCache = async (userId) => {
  try {
    await redis.del(`buyer_profile_${userId}`);
    console.log('Buyer cache cleared for:', userId);
  } catch (error) {
    console.error('Error clearing buyer cache:', error);
  }
};

// GET: Retrieve the buyer's profile
router.get('/profile', authMiddleware, async (req, res) => {
  const buyerId = req.user.id;
  const cacheKey = `buyer_profile_${buyerId}`;

  // Ensure the user is a buyer
  if (req.user.role !== 'buyer') {
    return res.status(403).json({ message: 'Access denied. Only buyers can access their profile.' });
  }

  try {
    // Try to get from cache first
    const cachedProfile = await redis.get(cacheKey);
    if (cachedProfile) {
      console.log('Serving buyer profile from cache');
      return res.json(JSON.parse(cachedProfile));
    }

    // Fetch buyer's profile from database
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

    // Cache the profile data
    await redis.setex(cacheKey, CACHE_EXPIRATION, JSON.stringify(profileData));
    console.log('Buyer profile cached for:', buyerId);

    res.json({ profile: profileData });
  } catch (error) {
    console.error('Error fetching buyer profile:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// PUT: Update buyer's profile
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

    // Clear the buyer's cache after update
    await clearBuyerCache(buyerId);

    res.json({ message: 'Buyer profile updated successfully.' });
  } catch (error) {
    console.error('Error updating buyer profile:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;
