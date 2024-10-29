// routes/regulations.js

const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all regulations
router.get('/', async (req, res) => {
  try {
    const sql = 'SELECT * FROM trade.gwtrade.Regulations';
    const regulations = await db.execute({ sqlText: sql });
    res.json(regulations);
  } catch (error) {
    console.error('Error fetching regulations:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add a new regulation
router.post('/', async (req, res) => {
  const { title, description, link, category } = req.body;

  if (!title || !description || !link || !category) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const id = uuidv4(); // Generate a unique ID
    const sql = `INSERT INTO trade.gwtrade.Regulations (ID, Title, Description, Link, Category, Date_Updated) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    await db.execute({
      sqlText: sql,
      binds: [id, title, description, link, category],
    });
    res.status(201).json({ message: 'Regulation added successfully' });
  } catch (error) {
    console.error('Error adding regulation:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
