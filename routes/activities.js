// routes/activities.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const db = require('../db');
const logger = require('../utils/logger');

const CACHE_EXPIRATION = 300; // 5 minutes for activities

// Helper function to clear activity cache
const clearActivityCache = async (userId) => {
  try {
    await redis.del(`activities_${userId}`);
    logger.info('Activity cache cleared for user:', userId);
  } catch (error) {
    logger.error('Error clearing activity cache:', error);
  }
};

router.get('/', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    // Fetch directly from database
    const rows = await db.execute({
      sqlText: `
        SELECT 
          ACTIVITY_ID AS id,
          MESSAGE AS message,
          TIMESTAMP AS timestamp,
          TYPE AS type
        FROM trade.gwtrade.Activities
        WHERE USER_ID = ?
        ORDER BY TIMESTAMP DESC
        LIMIT 50
      `,
      binds: [userId],
    });

    logger.info('Activities fetched for user:', userId);
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching activities:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Simple export of just the router
module.exports = router;