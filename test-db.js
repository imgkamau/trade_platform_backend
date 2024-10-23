// test-db.js

const db = require('./db');

const testQuery = () => {
  const sql = 'SELECT 1 AS TEST';
  db.execute({
    sqlText: sql,
    complete: (err, stmt, rows) => {
      if (err) {
        console.error('Test Query Error:', err);
      } else {
        console.log('Test Query Result:', rows);
      }
      process.exit(); // Exit after test
    },
  });
};

testQuery();
