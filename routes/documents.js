// routes/documents.js

const express = require('express');
const router = express.Router();
const cors = require('cors');
const multer = require('multer');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const AWS = require('aws-sdk');

// Load environment variables
require('dotenv').config();

// Configure AWS SDK
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID, // Set these in your environment variables
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// CORS configuration
const corsOptions = {
  origin:
    process.env.NODE_ENV === 'production'
      ? process.env.FRONTEND_URL || 'https://www.ke-eutrade.org'
      : process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};

// Apply CORS middleware to the router
router.use(cors(corsOptions));

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

/**
 * @route   POST /api/documents/upload
 * @desc    Upload a document
 * @access  Private (Authenticated users)
 */
router.post(
  '/upload',
  (req, res, next) => {
    logger.info('Received request at /api/documents/upload');
    next();
  },
  authMiddleware,
  (req, res, next) => {
    logger.info('Passed authMiddleware');
    next();
  },
  authorize(['seller', 'buyer']),
  (req, res, next) => {
    logger.info('Passed authorize middleware');
    next();
  },
  function (req, res, next) {
    logger.info('Starting file upload');
    upload.single('document')(req, res, function (err) {
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
    const { shipmentId, documentType } = req.body;
    const document = req.file;
    const userId = req.user.id;

    logger.info('Processing upload request', {
      shipmentId,
      documentType,
      userId,
      documentPresent: document ? true : false,
    });

    if (!shipmentId || !documentType) {
      logger.warn('Missing shipmentId or documentType');
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
      return res
        .status(400)
        .json({ message: 'Shipment ID and document type are required.' });
    }

    if (!document) {
      logger.warn('No document uploaded');
      return res.status(400).json({ message: 'No document uploaded' });
    }

    // Map documentType to typeId
    const documentTypeMap = {
      'Export Permit': 1,
      'Certificate of Origin': 2,
      'Invoice': 3,
      'Packing List': 4,
      'Phytosanitary Certificate': 5,
      'Global Gap Certificate': 6,
      'Other': 7,
      // Add other types as needed
    };

    const typeId = documentTypeMap[documentType];

    if (!typeId) {
      logger.error(`Invalid document type: ${documentType}`);
      // Delete the uploaded file since the document type is invalid
      fs.unlink(document.path, (err) => {
        if (err) {
          logger.error('Error deleting file after invalid document type:', err);
        } else {
          logger.info('Deleted uploaded file due to invalid document type');
        }
      });
      return res.status(400).json({ message: 'Invalid document type.' });
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
        Key: `documents/${documentId}-${document.originalname}`,
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

      // Insert the document metadata into the database
      await db.execute({
        sqlText: `
          INSERT INTO trade.gwtrade.Documents (
            DOCUMENT_ID,
            SHIPMENT_ID,
            TYPE_ID,
            FILE_PATH,
            USER_ID
          ) VALUES (?, ?, ?, ?, ?)
        `,
        binds: [documentId, shipmentId, typeId, s3Data.Location, userId],
      });

      logger.info(`Document uploaded successfully with ID: ${documentId}`);

      // Send response to the client
      return res.status(201).json({
        message: 'Document uploaded successfully',
        documentId,
        documentType,
        shipmentId,
      });
    } catch (error) {
      logger.error('Error uploading file to S3 or inserting into database:', error);
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
        message: 'Server error during file upload',
        error: error.message,
      });
    }
  }
);

// Apply authentication and authorization middleware to subsequent routes
router.use(authMiddleware);
router.use(authorize(['seller', 'buyer']));

// GET: Fetch documents
router.get('/', async (req, res) => {
  try {
    db.execute({
      sqlText: `
        SELECT 
          DOCUMENT_ID,
          SHIPMENT_ID,
          TYPE_ID,
          FILE_PATH,
          CREATED_AT
        FROM trade.gwtrade.Documents
        ORDER BY CREATED_AT DESC
      `,
      complete: function (err, stmt, rows) {
        if (err) {
          logger.error('Error fetching documents:', err);
          return res.status(500).json({
            message: 'Server error',
            error: err.message,
          });
        } else {
          logger.info(`Fetched ${rows.length} documents.`);
          res.json(rows);
        }
      },
    });
  } catch (error) {
    logger.error('Error fetching documents:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
});

// GET: Download a specific document
router.get('/:documentId', async (req, res) => {
  const { documentId } = req.params;

  try {
    db.execute({
      sqlText: `
        SELECT 
          TYPE_ID,
          FILE_PATH
        FROM trade.gwtrade.Documents
        WHERE DOCUMENT_ID = ?
      `,
      binds: [documentId],
      complete: function (err, stmt, rows) {
        if (err) {
          logger.error('Error fetching document:', err);
          return res.status(500).json({
            message: 'Server error',
            error: err.message,
          });
        } else {
          if (rows.length === 0) {
            return res.status(404).json({ message: 'Document not found' });
          }

          const document = rows[0];
          const fileUrl = document.FILE_PATH;

          // Generate a pre-signed URL for secure access
          const params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: `documents/${path.basename(fileUrl)}`,
            Expires: 60, // URL expires in 60 seconds
          };

          const url = s3.getSignedUrl('getObject', params);

          // Send the pre-signed URL to the client
          res.json({ url });
        }
      },
    });
  } catch (error) {
    logger.error('Error downloading document:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
});

// DELETE: Remove a document by ID
router.delete('/:documentId', async (req, res) => {
  const { documentId } = req.params;

  try {
    // Fetch the document record from the database
    db.execute({
      sqlText: `
        SELECT FILE_PATH
        FROM trade.gwtrade.Documents
        WHERE DOCUMENT_ID = ?
      `,
      binds: [documentId],
      complete: async function (err, stmt, rows) {
        if (err) {
          logger.error('Error fetching document:', err);
          return res.status(500).json({
            message: 'Server error',
            error: err.message,
          });
        } else {
          if (rows.length === 0) {
            return res.status(404).json({ message: 'Document not found' });
          }

          const document = rows[0];
          const fileUrl = document.FILE_PATH;
          const key = `documents/${path.basename(fileUrl)}`;

          // Delete the file from S3
          const params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key,
          };

          s3.deleteObject(params, async (err, data) => {
            if (err) {
              logger.error('Error deleting file from S3:', err);
              return res.status(500).json({
                message: 'Error deleting file from S3',
                error: err.message,
              });
            } else {
              logger.info('File deleted from S3');

              // Delete the record from the database
              await db.execute({
                sqlText: `
                  DELETE FROM trade.gwtrade.Documents
                  WHERE DOCUMENT_ID = ?
                `,
                binds: [documentId],
              });

              logger.info(`Document ID: ${documentId} deleted successfully.`);
              res.json({ message: 'Document deleted successfully.' });
            }
          });
        }
      },
    });
  } catch (error) {
    logger.error('Error deleting document:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
});

module.exports = router;
