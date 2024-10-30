// routes/documents.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer'); // For file uploads
const path = require('path');

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Directory to save uploaded files
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  },
});
const upload = multer({ storage });

// POST: Upload a document
router.post('/upload', upload.single('document'), async (req, res) => {
  const { shipmentId, documentType } = req.body;
  const documentPath = path.join(__dirname, '..', 'uploads', req.file.filename);

  try {
    await db.execute({
      sqlText: 'INSERT INTO trade.gwtrade.Documents (shipment_id, document_type, document_path) VALUES (?, ?, ?)',
      binds: [shipmentId, documentType, documentPath],
    });
    res.status(201).json({ message: 'Document uploaded successfully', documentPath });
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET: Fetch documents for a shipment
router.get('/:shipmentId', async (req, res) => {
  const { shipmentId } = req.params;

  try {
    const documents = await db.execute({
      sqlText: 'SELECT * FROM trade.gwtrade.Documents WHERE shipment_id = ?',
      binds: [shipmentId],
    });
    res.json(documents);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
