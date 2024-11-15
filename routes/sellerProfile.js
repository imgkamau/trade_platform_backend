// routes/sellerProfile.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Your updated db.js module
const authMiddleware = require('../middleware/auth'); // Authentication middleware
const authorize = require('../middleware/authorize'); // Authorization middleware
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger'); // Winston logger

/**
 * @route   PUT /api/seller/profile
 * @desc    Update seller profile information
 * @access  Private (Seller only)
 */
router.put(
    '/',
    authMiddleware,
    authorize(['seller']),
    [
        body('companyName')
            .optional()
            .isString().withMessage('Company Name must be a string')
            .isLength({ max: 255 }).withMessage('Company Name can be at most 255 characters long')
            .trim().escape(),
        body('businessRegistrationNumber')
            .optional()
            .isString().withMessage('Business Registration Number must be a string')
            .isLength({ max: 50 }).withMessage('Business Registration Number can be at most 50 characters long')
            .trim().escape(),
        body('address')
            .optional()
            .isString().withMessage('Address must be a string')
            .isLength({ max: 255 }).withMessage('Address can be at most 255 characters long')
            .trim().escape(),
        body('phoneNumber')
            .optional()
            .isString().withMessage('Phone Number must be a string')
            .isLength({ max: 50 }).withMessage('Phone Number can be at most 50 characters long')
            .matches(/^\+?[1-9]\d{1,14}$/).withMessage('Phone Number must be a valid E.164 format')
            .trim().escape(),
    ],
    async (req, res) => {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.warn(`Validation failed: ${JSON.stringify(errors.array())}`);
            return res.status(400).json({
                message: 'Validation failed',
                errors: errors.array(),
            });
        }

        const { companyName, businessRegistrationNumber, address, phoneNumber } = req.body;
        const userId = req.user.id; // Retrieved from authMiddleware

        logger.info(`Attempting to update profile for USER_ID: ${userId}`);

        // Build the SET clause dynamically based on provided fields
        const fields = [];
        const binds = [];

        if (companyName !== undefined) {
            fields.push('"COMPANY_NAME" = ?');
            binds.push(companyName);
        }
        if (businessRegistrationNumber !== undefined) {
            fields.push('"BUSINESS_REGISTRATION_NUMBER" = ?');
            binds.push(businessRegistrationNumber);
        }
        if (address !== undefined) {
            fields.push('"ADDRESS" = ?');
            binds.push(address);
        }
        if (phoneNumber !== undefined) {
            fields.push('"PHONE_NUMBER" = ?');
            binds.push(phoneNumber);
        }

        if (fields.length === 0) {
            logger.warn(`No valid fields provided for update by USER_ID: ${userId}`);
            return res.status(400).json({ message: 'No valid fields provided for update.' });
        }

        // Construct the SQL query without the trailing semicolon and with properly quoted identifiers
        const sqlQuery = `
            UPDATE "USERS"
            SET ${fields.join(', ')}
            WHERE "USER_ID" = ?
        `;
        binds.push(userId); // Add USER_ID as the last bind parameter

        logger.info(`Executing SQL: ${sqlQuery}`);
        logger.info(`Bind Parameters: ${JSON.stringify(binds)}`);

        try {
            const result = await db.execute({
                sqlText: sqlQuery,
                binds: binds,
            });

            logger.info(`SQL Execution Result: ${JSON.stringify(result)}`);

            // Check if any rows were affected
            if (result.rowsAffected > 0) {
                logger.info(`Seller profile updated successfully for USER_ID: ${userId}`);
                return res.status(200).json({ message: 'Profile updated successfully.' });
            } else {
                logger.warn(`No profile found to update for USER_ID: ${userId}`);
                return res.status(404).json({ message: 'Profile not found.' });
            }
        } catch (error) {
            logger.error(`Error updating seller profile for USER_ID: ${userId} - ${error.message}`);
            return res.status(500).json({ message: 'Server error', error: error.message });
        }
    }
);

module.exports = router;
