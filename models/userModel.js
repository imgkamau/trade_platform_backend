// models/userModel.js

const connection = require('../db');

exports.getBuyerProfile = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM trade.gwtrade.buyers WHERE USER_ID = ?`;
    connection.execute({
      sqlText: sql,
      binds: [userId],
      complete: (err, stmt, rows) => {
        if (err) {
          console.error('Error fetching buyer profile:', err);
          return reject(err);
        }
        if (!rows || rows.length === 0) {
          return resolve(null); // Buyer profile not found
        }
        resolve(rows[0]);
      },
    });
  });
};
