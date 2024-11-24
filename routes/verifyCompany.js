// routes/verifyCompany.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const authMiddleware = require('../middleware/auth');

// Load environment variables
require('dotenv').config();

// Configure AWS SDK
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID, // Set these in your environment variables
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// Configure Multer storage to use the system temporary directory
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, os.tmpdir()); // Use the /tmp directory
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

// File size limit and type validation
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx|jpg|jpeg|png/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(
        new Error(
          'Only PDF, DOC, DOCX, JPG, JPEG, and PNG files are allowed.'
        )
      );
    }
  },
});

// Authentication Middleware
// Assuming you have a middleware 'authMiddleware' that verifies JWT tokens and sets req.user
// If not, you can use the authenticateToken function from the previous implementation

/**
 * @route   POST /verify-company
 * @desc    Submit company verification data
 * @access  Private (Authenticated users)
 */
router.post(
  '/verify-company',
  (req, res, next) => {
    logger.info('Received request at /verify-company');
    next();
  },
  authMiddleware,
  (req, res, next) => {
    logger.info('Passed authMiddleware');
    next();
  },
  function (req, res, next) {
    logger.info('Starting file upload');
    upload.single('businessRegistrationDocument')(req, res, function (err) {
      if (err) {
        logger.error('Error during file upload:', err);
        return res
          .status(400)
          .json({ message: 'File upload error', error: err.message });
      }
      logger.info('File upload successful');
      next();
    });
  },
  async function (req, res) {
    logger.info('Entered route handler after file upload');
    const {
      registrationNumber,
      taxId,
      businessLicenseNumber,
      additionalInfo,
    } = req.body;
    const document = req.file;
    const userId = req.user.id;

    logger.info('Processing verification request', {
      userId,
      registrationNumber,
      taxId,
      businessLicenseNumber,
      additionalInfo,
      documentPresent: document ? true : false,
    });

    // Validate required fields
    if (!registrationNumber || !taxId || !businessLicenseNumber) {
      logger.warn('Missing required fields');
      // Delete the uploaded file since the request is invalid
      if (document && document.path) {
        fs.unlink(document.path, (err) => {
          if (err) {
            logger.error(
              'Error deleting file after validation failure:',
              err
            );
          } else {
            logger.info('Deleted uploaded file due to validation failure');
          }
        });
      }
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!document) {
      logger.warn('No document uploaded');
      return res
        .status(400)
        .json({ message: 'Business registration document is required' });
    }

    const documentId = uuidv4();
    const filePath = document.path; // This will now be in the /tmp directory

    logger.info('Uploading file to S3', { filePath });

    try {
      // Read the file content
      const fileContent = fs.readFileSync(filePath);

      // Set up S3 upload parameters
      const params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `company_verification/${documentId}-${document.originalname}`,
        Body: fileContent,
        ContentType: document.mimetype,
      };

      // Upload the file to S3
      const s3Data = await s3.upload(params).promise();
      logger.info(`File uploaded to S3 at ${s3Data.Location}`);

      // Delete the file from the /tmp directory
      fs.unlink(filePath, (err) => {
        if (err) {
          logger.error('Error deleting file from /tmp:', err);
        } else {
          logger.info('Deleted file from /tmp');
        }
      });

      // TODO: Save data to the database
      // For example:
      // await db.execute({
      //   sqlText: `
      //     INSERT INTO YourDatabase.CompanyVerifications (
      //       VERIFICATION_ID,
      //       USER_ID,
      //       REGISTRATION_NUMBER,
      //       TAX_ID,
      //       BUSINESS_LICENSE_NUMBER,
      //       ADDITIONAL_INFO,
      //       DOCUMENT_PATH
      //     ) VALUES (?, ?, ?, ?, ?, ?, ?)
      //   `,
      //   binds: [
      //     documentId,
      //     userId,
      //     registrationNumber,
      //     taxId,
      //     businessLicenseNumber,
      //     additionalInfo,
      //     s3Data.Location,
      //   ],
      // });

      // Simulate saving to the database
      console.log('Saved company verification data:', {
        verificationId: documentId,
        userId,
        registrationNumber,
        taxId,
        businessLicenseNumber,
        additionalInfo,
        documentPath: s3Data.Location,
      });

      logger.info(`Verification submitted successfully with ID: ${documentId}`);

      // Send response to the client
      return res.status(200).json({
        message: 'Verification submitted successfully',
        verificationId: documentId,
      });
    } catch (error) {
      logger.error(
        'Error uploading file to S3 or inserting into database:',
        error
      );
      // Delete the uploaded file in case of an error
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          logger.error(
            'Error deleting file after upload failure:',
            unlinkErr
          );
        } else {
          logger.info('Deleted uploaded file due to upload failure');
        }
      });
      return res.status(500).json({
        message: 'Server error during verification submission',
        error: error.message,
      });
    }
  }
);

module.exports = router;
