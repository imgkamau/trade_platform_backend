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

// Load environment variables
require('dotenv').config();

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
      'Global Gap Certificate':5,
      'Other':6,// Add other types as needed

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

    logger.info('Inserting document into database', {
      documentId,
      shipmentId,
      typeId,
      filePath,
      userId,
    });

    try {
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
        binds: [documentId, shipmentId, typeId, filePath, userId],
      });

      logger.info(`Document uploaded successfully with ID: ${documentId}`);

      // Note: Since the file is stored in a temporary directory, it will not persist across function invocations.
      // You should upload the file to a persistent storage (e.g., AWS S3) here.

      // Example code to upload to AWS S3 (if you choose to use S3):
      /*
      const AWS = require('aws-sdk');
      const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION,
      });

      const fileContent = fs.readFileSync(filePath);
      const params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `documents/${path.basename(filePath)}`,
        Body: fileContent,
        ContentType: document.mimetype,
      };

      const s3Data = await s3.upload(params).promise();
      logger.info(`File uploaded to S3 at ${s3Data.Location}`);

      // Update the filePath in the database to the S3 URL or key
      await db.execute({
        sqlText: `
          UPDATE trade.gwtrade.Documents
          SET FILE_PATH = ?
          WHERE DOCUMENT_ID = ?
        `,
        binds: [s3Data.Location, documentId],
      });

      // Delete the file from the /tmp directory
      fs.unlink(filePath, (err) => {
        if (err) {
          logger.error('Error deleting file from /tmp:', err);
        } else {
          logger.info('Deleted file from /tmp');
        }
      });
      */

      // Send response to the client
      return res.status(201).json({
        message: 'Document uploaded successfully',
        documentId,
        documentType,
        shipmentId,
      });
    } catch (error) {
      logger.error('Error inserting document into database:', error);
      // Delete the uploaded file in case of an error
      fs.unlink(document.path, (unlinkErr) => {
        if (unlinkErr) {
          logger.error(
            'Error deleting file after insert failure:',
            unlinkErr
          );
        } else {
          logger.info('Deleted uploaded file due to insert failure');
        }
      });
      return res.status(500).json({
        message: 'Server error',
        error: error.message,
      });
    }
  }
);

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
          const absolutePath = path.join(__dirname, '..', document.FILE_PATH);

          // Check if file exists
          if (!fs.existsSync(absolutePath)) {
            logger.error(`File not found at path: ${absolutePath}`);
            return res.status(404).json({ message: 'File not found.' });
          }

          res.download(absolutePath, path.basename(absolutePath), (err) => {
            if (err) {
              logger.error('Error sending file:', err);
              res.status(500).json({ message: 'Error downloading file.' });
            } else {
              logger.info(`File sent: ${absolutePath}`);
            }
          });
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
    // First, retrieve the file path
    db.execute({
      sqlText: `
        SELECT FILE_PATH
        FROM trade.gwtrade.Documents
        WHERE DOCUMENT_ID = ?
      `,
      binds: [documentId],
      complete: function (err, stmt) {
        if (err) {
          logger.error('Error fetching document:', err);
          return res.status(500).json({
            message: 'Server error',
            error: err.message,
          });
        } else {
          stmt.getRows(function (err, rows) {
            if (err) {
              logger.error('Error fetching rows:', err);
              return res.status(500).json({
                message: 'Server error',
                error: err.message,
              });
            } else {
              if (rows.length === 0) {
                return res.status(404).json({ message: 'Document not found' });
              }
              const document = rows[0];
              const absolutePath = path.join(
                __dirname,
                '..',
                document.FILE_PATH
              );

              // Delete the file from the filesystem
              fs.unlink(absolutePath, (err) => {
                if (err) {
                  logger.error(
                    `Error deleting file at ${absolutePath}: ${err.message}`
                  );
                  return res
                    .status(500)
                    .json({ message: 'Error deleting file.' });
                }

                // Delete the record from the database
                db.execute({
                  sqlText:
                    'DELETE FROM trade.gwtrade.Documents WHERE DOCUMENT_ID = ?',
                  binds: [documentId],
                  complete: function (err) {
                    if (err) {
                      logger.error(
                        'Error deleting document from database:',
                        err
                      );
                      return res.status(500).json({
                        message: 'Server error',
                        error: err.message,
                      });
                    } else {
                      logger.info(
                        `Document ID: ${documentId} deleted successfully.`
                      );
                      res.json({ message: 'Document deleted successfully.' });
                    }
                  },
                });
              });
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
