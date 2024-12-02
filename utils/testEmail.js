// utils/testEmail.js

const { sendQuoteResponseEmail } = require('./emailService');
const logger = require('./logger');

const testSendQuoteResponseEmail = async () => {
  try {
    await sendQuoteResponseEmail(
      'imgkamau@gmail.com', // Replace with a valid email
      'John Doe',               // buyerName
      'Test Product',           // productName
      99.99,                    // price (ensure it's a number)
      'Test notes for the quote response.', // notes (ensure it's a string)
      'test-quote-id-1234'      // quoteId
    );
    logger.info('Test quote response email sent successfully.');
  } catch (error) {
    logger.error('Failed to send test quote response email:', error);
  }
};

// Execute the test
testSendQuoteResponseEmail();
