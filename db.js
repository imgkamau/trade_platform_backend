// db.js

const snowflake = require('snowflake-sdk');
require('dotenv').config({ path: '.env' });

let connection;
let connectionPromise; // To store the promise of the ongoing connection attempt

// Helper function to get and validate environment variables
const getEnvVariable = (varName) => {
  const value = process.env[varName];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Environment variable ${varName} is required but not defined or is empty.`);
  }
  return value.trim();
};

// Helper function to execute a SQL command
const executeSql = (conn, sqlText) => {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      complete: function (err) {
        if (err) {
          console.error(`Error executing "${sqlText}":`, err);
          reject(err);
        } else {
          resolve();
        }
      },
    });
  });
};

const connectToSnowflake = () => {
  if (connection) {
    return Promise.resolve(connection);
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = new Promise(async (resolve, reject) => {
    try {
      // Get and validate environment variables
      const SNOWFLAKE_ACCOUNT = getEnvVariable('SNOWFLAKE_ACCOUNT');
      const SNOWFLAKE_USERNAME = getEnvVariable('SNOWFLAKE_USERNAME');
      const SNOWFLAKE_PASSWORD = getEnvVariable('SNOWFLAKE_PASSWORD');
      const SNOWFLAKE_WAREHOUSE = getEnvVariable('SNOWFLAKE_WAREHOUSE');
      const SNOWFLAKE_DATABASE = getEnvVariable('SNOWFLAKE_DATABASE');
      const SNOWFLAKE_SCHEMA = getEnvVariable('SNOWFLAKE_SCHEMA');
      const SNOWFLAKE_ROLE = process.env.SNOWFLAKE_ROLE ? process.env.SNOWFLAKE_ROLE.trim() : undefined;

      // Create a connection using environment variables
      connection = snowflake.createConnection({
        account: SNOWFLAKE_ACCOUNT,
        username: SNOWFLAKE_USERNAME,
        password: SNOWFLAKE_PASSWORD,
        role: SNOWFLAKE_ROLE,
        // Note: We're not setting warehouse, database, or schema here
      });

      // Connect to Snowflake
      connection.connect(async (err, conn) => {
        if (err) {
          console.error('Unable to connect: ' + err.message);
          reject(err);
        } else {
          console.log('Successfully connected to Snowflake.');

          try {
            // Execute USE WAREHOUSE
            await executeSql(conn, `USE WAREHOUSE ${SNOWFLAKE_WAREHOUSE}`);
            console.log(`Using warehouse: ${SNOWFLAKE_WAREHOUSE}`);

            // Execute USE DATABASE
            await executeSql(conn, `USE DATABASE ${SNOWFLAKE_DATABASE}`);
            console.log(`Using database: ${SNOWFLAKE_DATABASE}`);

            // Execute USE SCHEMA
            await executeSql(conn, `USE SCHEMA ${SNOWFLAKE_SCHEMA}`);
            console.log(`Using schema: ${SNOWFLAKE_SCHEMA}`);

            // Set the BINARY_OUTPUT_FORMAT to HEX
            await executeSql(conn, "ALTER SESSION SET BINARY_OUTPUT_FORMAT = 'HEX'");
            console.log('BINARY_OUTPUT_FORMAT set to HEX');

            resolve(connection);
          } catch (error) {
            console.error('Error setting session context:', error);
            reject(error);
          }
        }
      });
    } catch (error) {
      console.error('Error setting up connection:', error);
      reject(error);
    }
  });

  return connectionPromise;
};

// Add the execute function
const execute = (options) => {
  if (!connection) {
    throw new Error('Database connection is not established.');
  }

  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: options.sqlText,
      binds: options.binds,
      complete: function (err, stmt, rows) {
        if (err) {
          console.error(`Error executing query "${options.sqlText}":`, err);
          reject(err);
        } else {
          resolve(rows);
        }
      },
    });
  });
};

// Export the execute function and connectToSnowflake
module.exports = { execute, connectToSnowflake };
