const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  connectTimeout: 5000,        // 5 seconds
  commandTimeout: 3000,        // 3 seconds
  maxRetriesPerRequest: 1,     // Only retry once
  retryStrategy(times) {
    if (times > 1) return false; // Stop after one retry
    return 1000; // Wait 1 second before retry
  },
  enableOfflineQueue: false    // Don't queue commands when disconnected
});

// Add better error handling
redis.on('error', (err) => {
  console.error('Redis error:', err);
  if (err.code === 'ETIMEDOUT') {
    console.log('Redis timeout, attempting reconnect...');
    redis.disconnect();
    redis.connect();
  }
});

module.exports = redis; 