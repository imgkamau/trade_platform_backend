// routes/regulations.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid'); // Import uuid for generating unique IDs if needed

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

// Update an existing regulation
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, link, category } = req.body;

  // Validate that at least one field is provided to update
  if (!title && !description && !link && !category) {
    return res.status(400).json({ message: 'At least one field must be provided to update' });
  }

  // Build the update query dynamically
  const updates = [];
  const binds = [];

  if (title) {
    updates.push(`Title = ?`);
    binds.push(title);
  }
  if (description) {
    updates.push(`Description = ?`);
    binds.push(description);
  }
  if (link) {
    updates.push(`Link = ?`);
    binds.push(link);
  }
  if (category) {
    updates.push(`Category = ?`);
    binds.push(category);
  }

  // Add the ID to the binds
  binds.push(id);

  // Construct the SQL query
  const sql = `UPDATE trade.gwtrade.Regulations SET ${updates.join(', ')}, Date_Updated = CURRENT_TIMESTAMP WHERE ID = ?`;

  try {
    const result = await db.execute({
      sqlText: sql,
      binds: binds,
    });

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Regulation not found' });
    }

    res.json({ message: 'Regulation updated successfully' });
  } catch (error) {
    console.error('Error updating regulation:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
