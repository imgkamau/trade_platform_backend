// utils/activityLogger.js

const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger'); // Your logger utility

async function logActivity(userId, message, type) {
  const activityId = uuidv4();
  logger.info(`Logging activity: ID=${activityId}, UserID=${userId}, Message="${message}", Type=${type}`);
  try {
    await db.execute({
      sqlText: `
        INSERT INTO trade.gwtrade.Activities (
          ACTIVITY_ID,
          USER_ID,
          MESSAGE,
          TYPE,
          TIMESTAMP
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP())
      `,
      binds: [activityId, userId, message, type],
    });
    logger.info(`Activity logged successfully: ID=${activityId}`);
  } catch (error) {
    logger.error('Error logging activity:', error);
  }
}

module.exports = logActivity;
