const Redis = require('ioredis');

let redis;

try {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  });

  redis.on('error', (error) => {
    console.error('Redis connection error:', error);
  });

  redis.on('connect', () => {
    console.log('Successfully connected to Redis');
  });

} catch (error) {
  console.error('Redis initialization error:', error);
}

module.exports = redis; 