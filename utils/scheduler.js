// utils/scheduler.js

const cron = require('node-cron');
const db = require('../db');
const logger = require('./logger');
const nodemailer = require('nodemailer');

// Configure your email transporter (e.g., using Gmail SMTP)
const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.EMAIL_USER, // Your email
        pass: process.env.EMAIL_PASS  // Your email password or app-specific password
    }
});

// Schedule the job to run daily at 9 AM
cron.schedule('0 9 * * *', async () => {
    logger.info('Running scheduled job: Check for expiring documents.');

    try {
        const query = `
            SELECT d."document_id", d."user_id", dt."type_name", d."expiry_date", u."email", u."full_name"
            FROM "trade"."gwtrade"."Documents" d
            JOIN "trade"."gwtrade"."DOCUMENT_TYPES" dt ON d."type_id" = dt."type_id"
            JOIN "trade"."gwtrade"."Users" u ON d."user_id" = u."user_id"
            WHERE d."expiry_date" BETWEEN CURRENT_DATE() AND DATEADD(day, 30, CURRENT_DATE())
        `;
        const result = await db.execute({ sqlText: query });

        if (result.rows && result.rows.length > 0) {
            result.rows.forEach(async (doc) => {
                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: doc.EMAIL,
                    subject: `Reminder: Your ${doc.TYPE_NAME} is Expiring Soon`,
                    text: `Hello ${doc.FULL_NAME},

Your document (${doc.TYPE_NAME}) with ID ${doc.DOCUMENT_ID} is set to expire on ${doc.EXPIRY_DATE.toISOString().split('T')[0]}.

Please ensure you renew it before the expiry date to continue using our platform without interruptions.

Best regards,
Your Company Name`
                };

                // Send the email
                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        logger.error(`Error sending email to ${doc.EMAIL}: ${error.message}`);
                    } else {
                        logger.info(`Reminder email sent to ${doc.EMAIL}: ${info.response}`);
                    }
                });
            });
        } else {
            logger.info('No expiring documents found today.');
        }
    } catch (error) {
        logger.error(`Error during scheduled document expiry check: ${error.message}`);
    }
});

module.exports = () => {}; // Export an empty function if not needed elsewhere
