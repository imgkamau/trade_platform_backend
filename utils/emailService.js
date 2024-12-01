// utils/emailService.js

const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');
const logger = require('./logger'); // Ensure you have a logger utility
require('dotenv').config(); // To load environment variables

// **Nodemailer Configuration for Verification Emails**
const nodemailerTransporter = nodemailer.createTransport({
  service: 'gmail', // Use 'gmail' if you're using Gmail
  auth: {
    user: process.env.EMAIL_USER, // Your email address (e.g., xxxx@ke-eutrade.org)
    pass: process.env.EMAIL_PASS, // Your email password or app-specific password
  },
});

// Verify Nodemailer Transporter Configuration
nodemailerTransporter.verify((error, success) => {
  if (error) {
    logger.error('Nodemailer transporter configuration error:', error);
  } else {
    logger.info('Nodemailer transporter is configured successfully.');
  }
});

// **SendGrid Configuration for Quotation Request Emails**
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// **Function: Send Verification Email using Nodemailer**
const sendVerificationEmail = async (email, token) => {
  const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

  const mailOptions = {
    from: `"Your App Name" <${process.env.EMAIL_USER}>`, // Sender address
    to: email, // Recipient address
    subject: 'Email Verification',
    html: `
      <p>Please verify your email by clicking the link below:</p>
      <a href="${verificationLink}">Verify Email</a>
    `,
  };

  try {
    await nodemailerTransporter.sendMail(mailOptions);
    logger.info(`Verification email sent to ${email}`);
  } catch (error) {
    logger.error('Error sending verification email:', error);
    throw new Error('Email could not be sent');
  }
};

// **Function: Send Quote Request Email using SendGrid**
const sendQuoteRequestEmail = async (email, sellerName, buyerName, productName, quantity, quoteId) => {
  const quoteLink = `${process.env.FRONTEND_URL}/quotes/${quoteId}`; // Adjust based on your frontend routing

  const msg = {
    to: email,
    from: `"Trade Platform" <${process.env.EMAIL_FROM}>`, // Sender address (e.g., xxxxx@ke-eutrade.org)
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
    logger.error(`Error sending quote request email to ${email}:`, error);
    throw new Error('Quote request email could not be sent');
  }
};

const sendQuoteResponseEmail = async (email, buyerName, productName, price, notes, quoteId) => {
  const quoteLink = `${process.env.FRONTEND_URL}/quotes/${quoteId}`;

  const msg = {
    to: email,
    from: `"Trade Platform" <${process.env.EMAIL_FROM}>`,
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
    logger.error(`Error sending quote response email to buyer (${email}): ${error.message}`, error);
    throw new Error('Failed to send quote response email to buyer.');
  }
};

module.exports = { sendVerificationEmail, sendQuoteRequestEmail, sendQuoteResponseEmail };
