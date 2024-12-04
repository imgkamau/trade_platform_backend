// routes/matchmaking.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth'); // Middleware that sets req.user.id and req.user.role
const matchmaking = require('../utils/matchmaking');

router.get('/matchmaking', authMiddleware, async (req, res) => {
  const buyerId = req.user.id;

  // Ensure the user is a buyer
  if (req.user.role !== 'buyer') {
    return res.status(403).json({ message: 'Access denied. Only buyers can access matchmaking.' });
  }

  try {
    // Fetch buyer's profile
    const buyerResult = await db.execute({
      sqlText: `SELECT * FROM trade.gwtrade.buyers WHERE USER_ID = ?`,
      binds: [buyerId],
    });

    const buyerRows = buyerResult.rows || buyerResult;
    if (!buyerRows || buyerRows.length === 0) {
      return res.status(404).json({ message: 'Buyer profile not found' });
    }
    const buyer = buyerRows[0];

    // Fetch all sellers with company names
    const sellersResult = await db.execute({
      sqlText: `
        SELECT s.*, u.COMPANY_NAME
        FROM trade.gwtrade.sellers s
        JOIN trade.gwtrade.users u ON s.USER_ID = u.USER_ID
        WHERE u.ROLE = 'seller'
      `,
    });
    const sellerRows = sellersResult.rows || sellersResult;

    // Use the matchmaking function
    const matches = matchmaking.findMatches(buyer, sellerRows);

    res.json({ matches });
  } catch (error) {
    console.error('Error during matchmaking:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;
