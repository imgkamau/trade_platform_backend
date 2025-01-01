// routes/activities.js

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // If authentication is required
const authorize = require('../middleware/authorize'); // If role-based access control is needed
const db = require('../db'); // Your database connection
const logger = require('../utils/logger'); // Your logger utility
const redis = require('../config/redis');

const CACHE_EXPIRATION = 300; // 5 minutes for activities (since they update frequently)

// Helper function to clear activity cache
const clearActivityCache = async (userId) => {
  try {
    await redis.del(`activities_${userId}`);
    console.log('Activity cache cleared for user:', userId);
  } catch (error) {
    logger.error('Error clearing activity cache:', error);
  }
};

/**
 * @route   GET /api/activities
 * @desc    Get recent activities
 * @access  Private (Authenticated users)
 */
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const cacheKey = `activities_${userId}`;

  try {
    // Try to get from cache first
    const cachedActivities = await redis.get(cacheKey);
    if (cachedActivities) {
      logger.info('Serving activities from cache for user:', userId);
      return res.json(JSON.parse(cachedActivities));
    }

    // If not in cache, fetch from database with 48-hour filter
    const rows = await db.execute({
      sqlText: `
        SELECT 
          ACTIVITY_ID AS id,
          MESSAGE AS message,
          TIMESTAMP AS timestamp,
          TYPE AS type
        FROM trade.gwtrade.Activities
        WHERE USER_ID = ?
          AND TIMESTAMP >= DATEADD('hour', -48, CURRENT_TIMESTAMP())
        ORDER BY TIMESTAMP DESC
        LIMIT 50
      `,
      binds: [userId],
    });

    // Cache the results
    await redis.setex(cacheKey, CACHE_EXPIRATION, JSON.stringify(rows));
    logger.info('Activities cached for user:', userId);

    res.json(rows);
  } catch (error) {
    logger.error('Error fetching activities:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/activities
 * @desc    Log a new activity
 * @access  Private
 */
router.post('/', authMiddleware, async (req, res) => {
  const { message, type } = req.body;
  const userId = req.user.id;

  try {
    await db.execute({
      sqlText: `
        INSERT INTO trade.gwtrade.Activities 
        (ACTIVITY_ID, USER_ID, MESSAGE, TYPE, TIMESTAMP)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP())
      `,
      binds: [uuidv4(), userId, message, type],
    });

    // Clear user's activity cache
    await clearActivityCache(userId);

    res.status(201).json({ message: 'Activity logged successfully' });
  } catch (error) {
    logger.error('Error logging activity:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Export both router and cache clearing function
module.exports = {
  router,
  clearActivityCache, // Export this so other routes can clear activity cache when needed
};
