// utils/emailService.js

const nodemailer = require('nodemailer');
const logger = require('./logger'); // Ensure you have a logger utility
require('dotenv').config(); // To load environment variables

// Create a transporter object using the default SMTP transport
const transporter = nodemailer.createTransport({
  service: 'gmail', // Use 'gmail' if you're using Gmail
  auth: {
    user: process.env.EMAIL_USER, // Your email address
    pass: process.env.EMAIL_PASS, // Your email password or app-specific password
  },
});

// Function to send verification email
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
    await transporter.sendMail(mailOptions);
    logger.info(`Verification email sent to ${email}`);
  } catch (error) {
    logger.error('Error sending verification email:', error);
    throw new Error('Email could not be sent');
  }
};

// **New Function: Send Quote Request Email**
const sendQuoteRequestEmail = async (email, sellerName, buyerName, productName, quantity, quoteId) => {
  const quoteLink = `${process.env.FRONTEND_URL}/quotes/${quoteId}`; // Adjust based on your frontend routing

  const mailOptions = {
    from: `"Trade Platform" <${process.env.EMAIL_FROM}>`, // Sender address
    to: email, // Seller's email address
    subject: 'New Quote Request Received',
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
    await transporter.sendMail(mailOptions);
    logger.info(`Quote request email sent to ${email} for quote ID: ${quoteId}`);
  } catch (error) {
    logger.error(`Error sending quote request email to ${email}:`, error);
    throw new Error('Quote request email could not be sent');
  }
};

module.exports = { sendVerificationEmail, sendQuoteRequestEmail };
