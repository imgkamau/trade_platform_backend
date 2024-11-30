// utils/testEmail.js

const { sendQuoteRequestEmail } = require('./emailService');
const logger = require('./logger');

const testSendQuoteRequestEmail = async () => {
  try {
    await sendQuoteRequestEmail(
      'gwgekawar@gmail.com', // Replace with a valid email for testing
      'Syre',
      'Homecity Holdings',
      'Organic Coffee Beans',
      50,
      'test-quote-id-1234'
    );
    logger.info('Test quote request email sent successfully.');
  } catch (error) {
    logger.error('Failed to send test quote request email:', error);
  }
};

// Execute the test
testSendQuoteRequestEmail();
