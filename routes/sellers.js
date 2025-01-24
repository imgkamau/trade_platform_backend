const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// Update seller profile
router.put('/sellers/profile', authMiddleware, async (req, res) => {
  const sellerId = req.user.id;
  const { 
    PRODUCTS_OFFERED, 
    YEARS_OF_EXPERIENCE, 
    CERTIFICATIONS, 
    TARGET_MARKETS, 
    LOCATION 
  } = req.body;

  try {
    // Check if profile exists
    const existingProfile = await db.execute({
      sqlText: `SELECT USER_ID FROM trade.gwtrade.SELLERS WHERE USER_ID = ?`,
      binds: [sellerId]
    });

    if (existingProfile.rows && existingProfile.rows.length > 0) {
      // Update existing profile
      await db.execute({
        sqlText: `
          UPDATE trade.gwtrade.SELLERS
          SET 
            PRODUCTS_OFFERED = PARSE_JSON(?),
            YEARS_OF_EXPERIENCE = ?,
            CERTIFICATIONS = PARSE_JSON(?),
            TARGET_MARKETS = PARSE_JSON(?),
            LOCATION = ?
          WHERE USER_ID = ?
        `,
        binds: [
          JSON.stringify(PRODUCTS_OFFERED),
          YEARS_OF_EXPERIENCE,
          JSON.stringify(CERTIFICATIONS),
          JSON.stringify(TARGET_MARKETS),
          LOCATION,
          sellerId
        ]
      });
    } else {
      // Create new profile
      await db.execute({
        sqlText: `
          INSERT INTO trade.gwtrade.SELLERS (
            USER_ID,
            PRODUCTS_OFFERED,
            YEARS_OF_EXPERIENCE,
            CERTIFICATIONS,
            TARGET_MARKETS,
            LOCATION
          ) 
          SELECT 
            ?, 
            PARSE_JSON(?),
            ?,
            PARSE_JSON(?),
            PARSE_JSON(?),
            ?
        `,
        binds: [
          sellerId,
          JSON.stringify(PRODUCTS_OFFERED),
          YEARS_OF_EXPERIENCE,
          JSON.stringify(CERTIFICATIONS),
          JSON.stringify(TARGET_MARKETS),
          LOCATION
        ]
      });
    }

    res.json({ 
      message: 'Profile updated successfully',
      profile: {
        PRODUCTS_OFFERED,
        YEARS_OF_EXPERIENCE,
        CERTIFICATIONS,
        TARGET_MARKETS,
        LOCATION
      }
    });
  } catch (error) {
    console.error('Error updating seller profile:', error);
    res.status(500).json({ 
      message: 'Failed to update profile',
      error: error.message 
    });
  }
});

// Get seller profile
router.get('/sellers/profile', authMiddleware, async (req, res) => {
  const sellerId = req.user.id;

  try {
    const query = `
      SELECT 
        PRODUCTS_OFFERED,
        YEARS_OF_EXPERIENCE,
        CERTIFICATIONS,
        TARGET_MARKETS,
        LOCATION
      FROM trade.gwtrade.SELLERS 
      WHERE USER_ID = ?
    `;

    const result = await db.execute({
      sqlText: query,
      binds: [sellerId]
    });

    if (result.rows && result.rows.length > 0) {
      const profile = result.rows[0];
      res.json({
        PRODUCTS_OFFERED: profile.PRODUCTS_OFFERED || [],
        YEARS_OF_EXPERIENCE: profile.YEARS_OF_EXPERIENCE || 0,
        CERTIFICATIONS: profile.CERTIFICATIONS || [],
        TARGET_MARKETS: profile.TARGET_MARKETS || [],
        LOCATION: profile.LOCATION || ''
      });
    } else {
      res.json({
        PRODUCTS_OFFERED: [],
        YEARS_OF_EXPERIENCE: 0,
        CERTIFICATIONS: [],
        TARGET_MARKETS: [],
        LOCATION: ''
      });
    }
  } catch (error) {
    console.error('Error fetching seller profile:', error);
    res.status(500).json({ 
      message: 'Failed to fetch profile',
      error: error.message 
    });
  }
});

module.exports = router; 