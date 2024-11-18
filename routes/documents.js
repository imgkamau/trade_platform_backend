// routes/documents.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'uploads');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

// File size limit and type validation
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx|jpg|jpeg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, JPG, JPEG, and PNG files are allowed.'));
    }
  }
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
        return res.status(400).json({ message: 'File upload error', error: err.message });
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
      documentPresent: document ? true : false
    });

    if (!shipmentId || !documentType) {
      logger.warn('Missing shipmentId or documentType');
      // Delete the uploaded file since the request is invalid
      if (document && document.path) {
        fs.unlink(document.path, (err) => {
          if (err) {
            logger.error('Error deleting file after validation failure:', err);
          } else {
            logger.info('Deleted uploaded file due to validation failure');
          }
        });
      }
      return res.status(400).json({ message: 'Shipment ID and document type are required.' });
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
    const filePath = path.relative(path.join(__dirname, '..'), document.path);

    logger.info('Inserting document into database', {
      documentId,
      shipmentId,
      typeId,
      filePath,
      userId
    });

    try {
      // Execute the database insertion
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
        binds: [
          documentId,
          shipmentId,
          typeId,
          filePath,
          userId
        ],
      });

      logger.info(`Document uploaded successfully with ID: ${documentId}`);
      return res.status(201).json({
        message: 'Document uploaded successfully',
        documentId,
        documentType,
        shipmentId
      });
    } catch (error) {
      logger.error('Error inserting document into database:', error);
      // Delete the uploaded file in case of an error
      fs.unlink(document.path, (unlinkErr) => {
        if (unlinkErr) {
          logger.error('Error deleting file after insert failure:', unlinkErr);
        } else {
          logger.info('Deleted uploaded file due to insert failure');
        }
      });
      return res.status(500).json({
        message: 'Server error',
        error: error.message
      });
    }
  }
);

// GET: Fetch documents
router.get(
  '/',
  authMiddleware,
  authorize(['seller', 'buyer']),
  async (req, res) => {
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
              error: err.message
            });
          } else {
            // Fetch rows from the statement
            stmt.getRows(function (err, rows) {
              if (err) {
                logger.error('Error fetching rows:', err);
                return res.status(500).json({
                  message: 'Server error',
                  error: err.message
                });
              } else {
                logger.info(`Fetched ${rows.length} documents.`);
                res.json(rows);
              }
            });
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching documents:', error);
      res.status(500).json({
        message: 'Server error',
        error: error.message
      });
    }
  }
);

// GET: Download a specific document
router.get(
  '/:documentId',
  authMiddleware,
  authorize(['seller', 'buyer']),
  async (req, res) => {
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
              error: err.message
            });
          } else {
            stmt.getRows(function (err, rows) {
              if (err) {
                logger.error('Error fetching rows:', err);
                return res.status(500).json({
                  message: 'Server error',
                  error: err.message
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
            });
          }
        }
      });
    } catch (error) {
      logger.error('Error downloading document:', error);
      res.status(500).json({
        message: 'Server error',
        error: error.message
      });
    }
  }
);

// DELETE: Remove a document by ID
router.delete(
  '/:documentId',
  authMiddleware,
  authorize(['seller', 'buyer']),
  async (req, res) => {
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
        complete: function (err, stmt, rows) {
          if (err) {
            logger.error('Error fetching document:', err);
            return res.status(500).json({
              message: 'Server error',
              error: err.message
            });
          } else {
            stmt.getRows(function (err, rows) {
              if (err) {
                logger.error('Error fetching rows:', err);
                return res.status(500).json({
                  message: 'Server error',
                  error: err.message
                });
              } else {
                if (rows.length === 0) {
                  return res.status(404).json({ message: 'Document not found' });
                }
                const document = rows[0];
                const absolutePath = path.join(__dirname, '..', document.FILE_PATH);

                // Delete the file from the filesystem
                fs.unlink(absolutePath, (err) => {
                  if (err) {
                    logger.error(`Error deleting file at ${absolutePath}: ${err.message}`);
                    return res.status(500).json({ message: 'Error deleting file.' });
                  }

                  // Delete the record from the database
                  db.execute({
                    sqlText: 'DELETE FROM trade.gwtrade.Documents WHERE DOCUMENT_ID = ?',
                    binds: [documentId],
                    complete: function (err, stmt) {
                      if (err) {
                        logger.error('Error deleting document from database:', err);
                        return res.status(500).json({
                          message: 'Server error',
                          error: err.message
                        });
                      } else {
                        logger.info(`Document ID: ${documentId} deleted successfully.`);
                        res.json({ message: 'Document deleted successfully.' });
                      }
                    }
                  });
                });
              }
            });
          }
        }
      });
    } catch (error) {
      logger.error('Error deleting document:', error);
      res.status(500).json({
        message: 'Server error',
        error: error.message
      });
    }
  }
);

module.exports = router;
