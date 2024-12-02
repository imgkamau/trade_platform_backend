// testSendGridEmail.js

require('dotenv').config();
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const msg = {
  to: 'imgkamau@gmail.com', // Replace with your email
  from: `"Trade Platform" <${process.env.EMAIL_FROM}>`, // Must be a verified sender in SendGrid
  subject: 'Test Email from SendGrid',
  text: 'This is a test email sent using SendGrid.',
};

sgMail
  .send(msg)
  .then(() => {
    console.log('Test email sent successfully.');
  })
  .catch((error) => {
    console.error('Error sending test email:', error.response ? error.response.body : error);
  });
