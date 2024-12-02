// utils/emailService.js

require('dotenv').config(); // Load environment variables at the entry point
const sgMail = require('@sendgrid/mail');
const logger = require('./logger'); // Ensure you have a logger utility

// Set SendGrid API Key
const sendGridApiKey = process.env.SENDGRID_API_KEY;
if (!sendGridApiKey) {
  throw new Error('SENDGRID_API_KEY is not set in environment variables.');
}
sgMail.setApiKey(sendGridApiKey);

// Verify that EMAIL_FROM and FRONTEND_URL are set
const emailFrom = process.env.EMAIL_FROM;
const frontendUrl = process.env.FRONTEND_URL;

if (!emailFrom) {
  throw new Error('EMAIL_FROM is not set in environment variables.');
}
if (!frontendUrl) {
  throw new Error('FRONTEND_URL is not set in environment variables.');
}

/**
 * Send Verification Email using SendGrid
 * @param {string} email - Recipient's email address
 * @param {string} token - Verification token
 */
const sendVerificationEmail = async (email, token) => {
  // Parameter validation
  if (!email || typeof email !== 'string') {
    throw new Error('Invalid or missing email address.');
  }
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid or missing verification token.');
  }

  const verificationLink = `${frontendUrl}/verify-email?token=${token}`;

  const msg = {
    to: email,
    from: `"Your App Name" <${emailFrom}>`,
    subject: 'Email Verification',
    html: `
      <p>Hello,</p>
      <p>Please verify your email by clicking the link below:</p>
      <a href="${verificationLink}">Verify Email</a>
      <p>If you did not sign up for this account, you can ignore this email.</p>
      <p>Best regards,<br/>Your App Name Team</p>
    `,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Verification email sent to ${email}`);
  } catch (error) {
    logger.error(
      `Error sending verification email to ${email}:`,
      error.response ? error.response.body : error
    );
    throw new Error('Email could not be sent');
  }
};

/**
 * Send Quote Request Email using SendGrid
 * @param {string} email - Seller's email address
 * @param {string} sellerName - Seller's name
 * @param {string} buyerName - Buyer's name
 * @param {string} productName - Product name
 * @param {number} quantity - Quantity requested
 * @param {string} quoteId - Quote ID
 */
const sendQuoteRequestEmail = async (email, sellerName, buyerName, productName, quantity, quoteId) => {
  // Parameter validation
  if (!email || typeof email !== 'string') {
    throw new Error('Invalid or missing email address.');
  }
  if (!sellerName || typeof sellerName !== 'string') {
    throw new Error('Invalid or missing seller name.');
  }
  if (!buyerName || typeof buyerName !== 'string') {
    throw new Error('Invalid or missing buyer name.');
  }
  if (!productName || typeof productName !== 'string') {
    throw new Error('Invalid or missing product name.');
  }
  if (typeof quantity !== 'number' || isNaN(quantity) || quantity <= 0) {
    throw new Error('Invalid quantity value.');
  }
  if (!quoteId || typeof quoteId !== 'string') {
    throw new Error('Invalid or missing quote ID.');
  }

  const quoteLink = `${frontendUrl}/quotes/${quoteId}`;

  const msg = {
    to: email,
    from: `"Trade Platform" <${emailFrom}>`,
    subject: 'New Quote Request Received',
    text: `Hello ${sellerName},

You have received a new quote request for your product "${productName}".

Details:
- Quantity: ${quantity}
- Buyer: ${buyerName}

Please visit the following link to view and respond to this quote:
${quoteLink}

Best regards,
Trade Platform Team`,
    html: `
      <p>Hello ${sellerName},</p>
      <p>You have received a new quote request for your product "<strong>${productName}</strong>".</p>
      <p><strong>Details:</strong></p>
      <ul>
        <li>Quantity: ${quantity}</li>
        <li>Buyer: ${buyerName}</li>
      </ul>
      <p>Please <a href="${quoteLink}">click here</a> to view and respond to this quote.</p>
      <p>Best regards,<br/>Trade Platform Team</p>
    `,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Quote request email sent to ${email} for quote ID: ${quoteId}`);
  } catch (error) {
    logger.error(
      `Error sending quote request email to ${email}:`,
      error.response ? error.response.body : error
    );
    throw new Error('Quote request email could not be sent');
  }
};

/**
 * Send Quote Response Email using SendGrid
 * @param {string} email - Buyer's email address
 * @param {string} buyerName - Buyer's name
 * @param {string} productName - Product name
 * @param {number} price - Price per unit
 * @param {string} notes - Seller's notes
 * @param {string} quoteId - Quote ID
 */
const sendQuoteResponseEmail = async (email, buyerName, productName, price, notes, quoteId) => {
  // Parameter validation
  if (!email || typeof email !== 'string') {
    throw new Error('Invalid or missing email address.');
  }
  if (!buyerName || typeof buyerName !== 'string') {
    throw new Error('Invalid or missing buyer name.');
  }
  if (!productName || typeof productName !== 'string') {
    throw new Error('Invalid or missing product name.');
  }
  if (typeof price !== 'number' || isNaN(price) || price < 0) {
    throw new Error('Invalid price value.');
  }
  if (typeof notes !== 'string') {
    notes = '';
  }
  if (!quoteId || typeof quoteId !== 'string') {
    throw new Error('Invalid or missing quote ID.');
  }

  const quoteLink = `${frontendUrl}/quotes/${quoteId}`;

  const msg = {
    to: email,
    from: `"Trade Platform" <${emailFrom}>`,
    subject: 'Your Quote Request Has Been Responded To',
    text: `Hello ${buyerName},

You have received a response to your quote request for "${productName}".

Details:
- Price per Unit: $${price.toFixed(2)}
- Notes: ${notes || 'No additional notes.'}

Please visit the following link to view the details:
${quoteLink}

Best regards,
Trade Platform Team`,
    html: `
      <p>Hello ${buyerName},</p>
      <p>You have received a response to your quote request for "<strong>${productName}</strong>".</p>
      <p><strong>Details:</strong></p>
      <ul>
        <li>Price per Unit: $${price.toFixed(2)}</li>
        <li>Notes: ${notes ? notes.replace(/\n/g, '<br/>') : 'No additional notes.'}</li>
      </ul>
      <p>Please <a href="${quoteLink}">click here</a> to view the details.</p>
      <p>Best regards,<br/>Trade Platform Team</p>
    `,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Quote response email sent to buyer: ${email} for Quote ID=${quoteId}`);
  } catch (error) {
    logger.error(
      `Error sending quote response email to buyer (${email}):`,
      error.response ? error.response.body : error
    );
    throw new Error('Failed to send quote response email to buyer.');
  }
};

module.exports = {
  sendVerificationEmail,
  sendQuoteRequestEmail,
  sendQuoteResponseEmail,
};
