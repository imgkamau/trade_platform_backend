const express = require('express');
const router = express.Router();
const redis = require('../config/redis');

router.get('/redis-test', async (req, res) => {
  try {
    // Test setting a value
    await redis.set('test_key', 'Hello Redis!');
    
    // Test getting the value
    const value = await redis.get('test_key');
    
    res.json({ 
      status: 'success',
      message: 'Redis connection working',
      test_value: value 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      message: error.message 
    });
  }
});

module.exports = router; 