// test_snowflake.js

const snowflake = require('snowflake-sdk');

// Replace with your actual connection configuration
const connection = snowflake.createConnection({
  account: 'na79368.eu-west-3.aws',
  username: 'kwaruingi',
  password: '7uKaveza@31',
  warehouse: 'EUTRADE',
  database: 'TRADE',
  schema: 'GWTRADE',
});

connection.connect(function (err, conn) {
  if (err) {
    console.error('Unable to connect: ' + err.message);
  } else {
    console.log('Successfully connected to Snowflake.');
    // Execute the query
    connection.execute({
      sqlText: 'SELECT TYPE_NAME FROM TRADE.GWTRADE.DOCUMENT_TYPES',
      complete: function (err, stmt, rows) {
        if (err) {
          console.error('Failed to execute statement due to the following error: ' + err.message);
        } else {
          console.log('Query Results:');
          console.log(rows);
          // Close the connection
          connection.destroy(function (err, conn) {
            if (err) {
              console.error('Unable to disconnect: ' + err.message);
            } else {
              console.log('Disconnected from Snowflake.');
            }
          });
        }
      },
    });
  }
});
