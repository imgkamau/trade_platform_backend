// config/nodemailer.js

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendEmail = async (options) => {
  const msg = {
    to: options.to,
    from: process.env.EMAIL_FROM, // your verified sender in SendGrid
    subject: options.subject,
    html: options.html,
  };

  try {
    await sgMail.send(msg);
    console.log('Email sent successfully');
  } catch (error) {
    console.error('SendGrid error:', error);
    if (error.response) {
      console.error('Error details:', error.response.body);
    }
    throw error;
  }
};

module.exports = sendEmail;
