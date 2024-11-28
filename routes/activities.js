// routes/activities.js

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // If authentication is required
const authorize = require('../middleware/authorize'); // If role-based access control is needed
const db = require('../db'); // Your database connection
const logger = require('../utils/logger'); // Your logger utility

/**
 * @route   GET /api/activities
 * @desc    Get recent activities
 * @access  Private (Authenticated users)
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Fetch activities from the database
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
      binds: [req.user.id], // Assuming activities are user-specific
    });

    res.json(rows);
  } catch (error) {
    logger.error('Error fetching activities:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
