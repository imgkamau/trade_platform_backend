const express = require('express'); 
const router = express.Router();
const multer = require('multer');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { v4: uuidv4 } = require('uuid');

const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST: Upload a document
router.post('/upload', authMiddleware, authorize(['seller', 'buyer']), upload.single('document'), async (req, res) => {
  const { shipmentId, documentType } = req.body;
  const document = req.file;

  console.log('Received upload request:', { shipmentId, documentType, document: document ? 'present' : 'missing' });

  if (!shipmentId || !documentType) {
    return res.status(400).json({ message: 'Shipment ID and document type are required.' });
  }

  if (!document) {
    return res.status(400).json({ message: 'No document uploaded' });
  }

  try {
    const documentId = uuidv4(); // Generate a UUID for DOCUMENT_ID
    const filePath = `documents/${documentId}-${document.originalname}`; // Generate a file path

    console.log('Inserting document into database:', {
      documentId,
      shipmentId,
      documentType,
      filePath,
      bufferLength: document.buffer.length
    });

    // Convert the buffer to a hex string
    const hexString = document.buffer.toString('hex');

    // Save the document to the database
    await db.execute({
      sqlText: `
        INSERT INTO trade.gwtrade.Documents (
          DOCUMENT_ID,
          SHIPMENT_ID,
          DOCUMENT_TYPE,
          FILE_PATH,
          FILE_DATA
        ) VALUES (?, ?, ?, ?, ?)
      `,
      binds: [
        documentId,
        shipmentId,
        documentType,
        filePath,
        hexString // Use the hex string instead of the buffer
      ]
    });

    res.status(201).json({
      message: 'Document uploaded successfully',
      documentId,
      documentType,
      shipmentId
    });
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
});

// GET: Fetch documents
//router.get('/', authMiddleware, async (req, res) => {
router.get('/', async (req, res) => {
  try {
    const documents = await db.execute({
      sqlText: `
        SELECT 
          DOCUMENT_ID,
          SHIPMENT_ID,
          DOCUMENT_TYPE,
          FILE_PATH,
          CREATED_AT
        FROM trade.gwtrade.Documents
        ORDER BY CREATED_AT DESC
      `
    });

    res.json(documents);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
});

// GET: Download a specific document
//router.get('/:documentId', authMiddleware, async (req, res) => {
  router.get('/:documentId', async (req, res) => {
  const { documentId } = req.params;

  try {
    const [document] = await db.execute({
      sqlText: `
        SELECT 
          DOCUMENT_TYPE,
          FILE_PATH,
          FILE_DATA
        FROM trade.gwtrade.Documents
        WHERE DOCUMENT_ID = ?
      `,
      binds: [documentId]
    });

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const fileDataHex = document.FILE_DATA;

    if (!fileDataHex) {
      return res.status(404).json({ message: 'Document data not found' });
    }

    // Convert hex string back to buffer
    const fileDataBuffer = Buffer.from(fileDataHex, 'hex');

    // Set appropriate headers for file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${document.FILE_PATH.split('/').pop()}"`);

    // Send the file data
    res.send(fileDataBuffer);
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
});

// Optional: DELETE route to remove a document by ID
router.delete('/:documentId', authMiddleware, async (req, res) => {
  const { documentId } = req.params;

  try {
    await db.execute({
      sqlText: 'DELETE FROM trade.gwtrade.Documents WHERE document_id = ?',
      binds: [documentId]
    });

    res.json({ message: 'Document deleted successfully.' });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
