// db.js

const snowflake = require('snowflake-sdk');
const env = process.env.NODE_ENV || 'development';
if (env !== 'production') {
  require('dotenv').config({ path: `.env.${env}` });
}

let connection;
let connectionPromise; // To store the promise of the ongoing connection attempt

const logger = require('./utils/logger'); // Use your logger utility

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
          logger.error(`Error executing "${sqlText}":`, err);
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
    const timeoutDuration = 5000; // 5 seconds
    const timeout = setTimeout(() => {
      logger.error('Snowflake connection timed out.');
      // Reset connection variables
      connection = null;
      connectionPromise = null;
      reject(new Error('Snowflake connection timed out.'));
    }, timeoutDuration);

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
        timezone: 'UTC', // Ensure timezone is set to UTC
        // Note: We're not setting warehouse, database, or schema here
      });

      // Connect to Snowflake
      connection.connect(async (err, conn) => {
        clearTimeout(timeout);
        if (err) {
          logger.error('Unable to connect: ' + err.message);
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

            // Verify Timezone Parameter
            try {
              const timezoneRows = await new Promise((resolve, reject) => {
                conn.execute({
                  sqlText: "SHOW PARAMETERS LIKE 'TIMEZONE';",
                  complete: (err, stmt, rows) => {
                    if (err) {
                      logger.error('Error executing SHOW PARAMETERS:', err);
                      return reject(err);
                    }
                    resolve(rows);
                  },
                });
              });

              // Log the retrieved rows
              logger.debug('Timezone Rows:', timezoneRows);

              // Correct property names based on Snowflake's response
              const timezoneRow = timezoneRows.find(
                row => row.key === 'TIMEZONE' || row.KEY === 'TIMEZONE'
              );

              if (!timezoneRow) {
                throw new Error('TIMEZONE parameter not found in Snowflake session.');
              }

              const timezoneValue = timezoneRow.value || timezoneRow.VALUE;

              logger.info(`Snowflake Session Timezone: ${timezoneValue}`);

              if (timezoneValue !== 'UTC') {
                logger.warn(`Current timezone is ${timezoneValue}. Attempting to set it to UTC.`);
                
                // Set timezone to UTC
                await executeSql(conn, "ALTER SESSION SET TIMEZONE = 'UTC'");
                logger.info('Session timezone set to UTC.');

                // Re-verify the timezone
                const updatedTimezoneRows = await new Promise((resolve, reject) => {
                  conn.execute({
                    sqlText: "SHOW PARAMETERS LIKE 'TIMEZONE';",
                    complete: (err, stmt, rows) => {
                      if (err) {
                        logger.error('Error executing SHOW PARAMETERS:', err);
                        return reject(err);
                      }
                      resolve(rows);
                    },
                  });
                });

                const updatedTimezoneRow = updatedTimezoneRows.find(
                  row => row.key === 'TIMEZONE' || row.KEY === 'TIMEZONE'
                );

                if (!updatedTimezoneRow) {
                  throw new Error('TIMEZONE parameter not found after attempting to set it.');
                }

                const updatedTimezoneValue = updatedTimezoneRow.value || updatedTimezoneRow.VALUE;

                logger.info(`Updated Snowflake Session Timezone: ${updatedTimezoneValue}`);

                if (updatedTimezoneValue !== 'UTC') {
                  throw new Error(`Failed to set session timezone to UTC. Current timezone is ${updatedTimezoneValue}.`);
                } else {
                  logger.info('Session timezone successfully set to UTC.');
                }
              } else {
                logger.info('Session timezone is already set to UTC.');
              }

              resolve(connection);
            } catch (timezoneError) {
              logger.error('Error verifying or setting TIMEZONE:', timezoneError);
              // Reset connection variables
              connection = null;
              connectionPromise = null;
              reject(timezoneError);
            }

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
      clearTimeout(timeout);
      logger.error('Error setting up connection:', error);
      // Reset connection variables
      connection = null;
      connectionPromise = null;
      reject(error);
    }
  });

  return connectionPromise;
};

// Updated execute function to return a Promise and support async/await
const execute = (options) => {
  if (!connection) {
    throw new Error('Database connection is not established.');
  }

  logger.debug(`Executing SQL query: ${options.sqlText} with binds: ${JSON.stringify(options.binds)}`);

  return new Promise((resolve, reject) => {
    connection.execute({
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
};

// Export the execute function and connectToSnowflake
module.exports = { execute, connectToSnowflake };
