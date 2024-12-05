// models/userModel.js

const db = require('../db'); // Ensure db is correctly required

exports.getBuyerProfile = async (userId) => {
  console.log(`Fetching buyer profile for user ID: ${userId}`);
  try {
    const sql = `SELECT * FROM trade.gwtrade.BUYERS WHERE USER_ID = ?`;
    const result = await db.execute({
      sqlText: sql,
      binds: [userId],
    });

    const rows = result.rows || result;
    if (!rows || rows.length === 0) {
      console.log('No buyer profile found');
      return null; // Buyer profile not found
    }
    console.log('Buyer profile fetched successfully');
    return rows[0];
  } catch (err) {
    console.error('Error fetching buyer profile:', err);
    throw err;
  }
};
