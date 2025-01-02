const Redis = require('ioredis');

let redis;

try {
  redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: false
  });

  redis.on('error', (error) => {
    console.error('Redis connection error:', error);
    // Fallback to no caching if Redis fails
    redis = {
      get: async () => null,
      set: async () => null,
      setex: async () => null,
      del: async () => null
    };
  });

  redis.on('connect', () => {
    console.log('Successfully connected to Redis');
  });

} catch (error) {
  console.error('Redis initialization error:', error);
  // Fallback to no caching if Redis fails
  redis = {
    get: async () => null,
    set: async () => null,
    setex: async () => null,
    del: async () => null
  };
}

module.exports = redis; 