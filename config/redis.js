const Redis = require('ioredis');

let redis;

try {
  // Parse Redis URL to handle authentication
  const redisURL = new URL(process.env.REDIS_URL);
  
  redis = new Redis({
    host: redisURL.hostname,
    port: redisURL.port || 6379,
    password: redisURL.password, // This handles the authentication
    username: redisURL.username,
    tls: {
      rejectUnauthorized: false // Required for some Redis providers
    },
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: null,
    enableReadyCheck: false
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