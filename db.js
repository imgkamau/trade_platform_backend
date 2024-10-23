// db.js

const snowflake = require('snowflake-sdk');
require('dotenv').config({ path: '.env' });

let connection;

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
  return new Promise(async (resolve, reject) => {
    if (connection) {
      resolve(connection);
    } else {
      try {
        // Get and validate environment variables
        const SNOWFLAKE_ACCOUNT = getEnvVariable('SNOWFLAKE_ACCOUNT');
        const SNOWFLAKE_USERNAME = getEnvVariable('SNOWFLAKE_USERNAME');
        const SNOWFLAKE_PASSWORD = getEnvVariable('SNOWFLAKE_PASSWORD');
        const SNOWFLAKE_WAREHOUSE = getEnvVariable('SNOWFLAKE_WAREHOUSE');
        const SNOWFLAKE_DATABASE = getEnvVariable('SNOWFLAKE_DATABASE');
        const SNOWFLAKE_SCHEMA = getEnvVariable('SNOWFLAKE_SCHEMA');
        const SNOWFLAKE_ROLE = process.env.SNOWFLAKE_ROLE ? process.env.SNOWFLAKE_ROLE.trim() : undefined;

        // Log the environment variables to ensure they are loaded correctly
        console.log('SNOWFLAKE_ACCOUNT:', JSON.stringify(SNOWFLAKE_ACCOUNT));
        console.log('SNOWFLAKE_WAREHOUSE:', JSON.stringify(SNOWFLAKE_WAREHOUSE));
        console.log('SNOWFLAKE_DATABASE:', JSON.stringify(SNOWFLAKE_DATABASE));
        console.log('SNOWFLAKE_SCHEMA:', JSON.stringify(SNOWFLAKE_SCHEMA));

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
    }
  });
};

// Add the execute function
const execute = async (options) => {
  try {
    // Ensure the connection is established
    await connectToSnowflake();

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
  } catch (err) {
    console.error('Error getting Snowflake connection:', err);
    throw err;
  }
};

// Export the execute function
module.exports = { execute };
