const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const userModel = require('../models/userModel');
const findMatches = require('../utils/matchmaking');

router.get('/matchmaking', authMiddleware, async (req, res) => {
  try {
    const result = await findMatches(req.user.id, db);
    
    if (result.code === 'NO_MATCHES') {
      return res.status(200).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('Matchmaking error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to complete matchmaking process.',
      message: 'Failed to complete matchmaking'
    });
  }
});

module.exports = router;