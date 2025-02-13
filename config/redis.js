const Redis = require('ioredis');
const logger = require('./utils/logger');

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
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    tls: false,
    reconnectOnError(err) {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    }
  });

  redis.on('error', (error) => {
    logger.error('Redis connection error:', error);
    redis = createNullRedis();
  });

  redis.on('connect', () => {
    logger.info('Successfully connected to Redis');
  });

  redis.on('reconnecting', (delay) => {
    logger.warn(`Reconnecting to Redis in ${delay}ms...`);
  });

} catch (error) {
  logger.error('Redis initialization error:', error);
  redis = createNullRedis();
}

function createNullRedis() {
  return {
    get: async () => {
      logger.debug('Redis unavailable, returning null for GET operation');
      return null;
    },
    set: async () => {
      logger.debug('Redis unavailable, skipping SET operation');
      return null;
    },
    setex: async () => {
      logger.debug('Redis unavailable, skipping SETEX operation');
      return null;
    },
    del: async () => {
      logger.debug('Redis unavailable, skipping DEL operation');
      return null;
    }
  };
}

module.exports = redis; 