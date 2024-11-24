// db.js

const snowflake = require('snowflake-sdk');
const logger = require('./utils/logger'); // Adjust the path to your logger utility if necessary

let connection = null;
let connectionPromise = null;

// Helper function to get and validate environment variables
const getEnvVariable = (varName) => {
  const value = process.env[varName];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Environment variable ${varName} is required but not defined or is empty.`);
  }
  return value.trim();
};

// Function to establish a connection to Snowflake
const connectToSnowflake = () => {
  if (connection && connection.isUp()) {
    return Promise.resolve(connection);
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = new Promise(async (resolve, reject) => {
    try {
      // Get and validate environment variables inside the function
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
        timezone: 'UTC', // Ensure timezone is set to UTC
        // Note: Warehouse, database, and schema will be set after connection
      });

      // Connect to Snowflake
      connection.connect(async (err, conn) => {
        if (err) {
          logger.error('Unable to connect to Snowflake:', err.message);
          // Reset connection variables
          connection = null;
          connectionPromise = null;
          reject(err);
        } else {
          logger.info('Successfully connected to Snowflake.');

          try {
            // Execute USE WAREHOUSE
            await executeSql(conn, `USE WAREHOUSE ${SNOWFLAKE_WAREHOUSE}`);
            logger.info(`Using warehouse: ${SNOWFLAKE_WAREHOUSE}`);

            // Execute USE DATABASE
            await executeSql(conn, `USE DATABASE ${SNOWFLAKE_DATABASE}`);
            logger.info(`Using database: ${SNOWFLAKE_DATABASE}`);

            // Execute USE SCHEMA
            await executeSql(conn, `USE SCHEMA ${SNOWFLAKE_SCHEMA}`);
            logger.info(`Using schema: ${SNOWFLAKE_SCHEMA}`);

            // Set the BINARY_OUTPUT_FORMAT to HEX
            await executeSql(conn, "ALTER SESSION SET BINARY_OUTPUT_FORMAT = 'HEX'");
            logger.info('BINARY_OUTPUT_FORMAT set to HEX');

            // Set timezone to UTC
            await executeSql(conn, "ALTER SESSION SET TIMEZONE = 'UTC'");
            logger.info('Session timezone set to UTC.');

            resolve(connection);
          } catch (error) {
            logger.error('Error setting session context:', error);
            // Reset connection variables
            connection = null;
            connectionPromise = null;
            reject(error);
          }
        }
      });
    } catch (error) {
      logger.error('Error setting up Snowflake connection:', error);
      // Reset connection variables
      connection = null;
      connectionPromise = null;
      reject(error);
    }
  });

  return connectionPromise;
};

// Helper function to execute a SQL command without returning results
const executeSql = (conn, sqlText) => {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      complete: function (err) {
        if (err) {
          logger.error(`Error executing "${sqlText}":`, err);
          reject(err);
        } else {
          resolve();
        }
      },
    });
  });
};

// Function to execute queries
const execute = async (options) => {
  try {
    const conn = await connectToSnowflake();

    logger.debug(`Executing SQL query: ${options.sqlText} with binds: ${JSON.stringify(options.binds)}`);

    return new Promise((resolve, reject) => {
      conn.execute({
        sqlText: options.sqlText,
        binds: options.binds || [],
        complete: function (err, stmt, rows) {
          if (err) {
            logger.error(`Error executing query "${options.sqlText}":`, err);
            reject(err);
          } else {
            resolve(rows);
          }
        },
      });
    });
  } catch (err) {
    logger.error('Error in execute function:', err);
    throw err;
  }
};

// Export the execute function and connectToSnowflake
module.exports = { execute, connectToSnowflake };
