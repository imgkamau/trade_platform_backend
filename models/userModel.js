// models/userModel.js
const connection = require('../db');

exports.getBuyerProfile = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM TRADE.GWTRADE.buyers WHERE USER_ID = ?`;
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

exports.getSellerProfiles = () => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT s.*, u.COMPANY_NAME
      FROM TRADE.GWTRADE.sellers s
      JOIN TRADE.GWTRADE.users u ON s.USER_ID = u.USER_ID
      WHERE u.ROLE = 'seller'
    `;
    connection.execute({
      sqlText: sql,
      complete: (err, stmt, rows) => {
        if (err) {
          console.error('Error fetching seller profiles:', err);
          return reject(err);
        }
        resolve(rows);
      },
    });
  });
};
