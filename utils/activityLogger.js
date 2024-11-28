// utils/activityLogger.js

const db = require('../db');
const { v4: uuidv4 } = require('uuid');

async function logActivity(userId, message, type) {
  const activityId = uuidv4();
  try {
    await db.execute({
      sqlText: `
        INSERT INTO trade.gwtrade.Activities (ACTIVITY_ID, USER_ID, MESSAGE, TYPE)
        VALUES (?, ?, ?, ?)
      `,
      binds: [activityId, userId, message, type],
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

module.exports = logActivity;
