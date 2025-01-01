const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const redis = require('../config/redis');

const CACHE_EXPIRATION = 3600; // 1 hour

// Helper function to clear checklist cache
const clearChecklistCache = async (checklistId = null) => {
  try {
    // Clear all checklists cache
    await redis.del('all_checklists');
    
    // If specific checklist, clear its items cache too
    if (checklistId) {
      await redis.del(`checklist_items_${checklistId}`);
      console.log('Cache cleared for checklist:', checklistId);
    }
  } catch (error) {
    console.error('Error clearing checklist cache:', error);
  }
};

// Get all checklists
router.get('/', async (req, res) => {
  try {
    // Try to get from cache first
    const cachedChecklists = await redis.get('all_checklists');
    if (cachedChecklists) {
      console.log('Serving checklists from cache');
      return res.json(JSON.parse(cachedChecklists));
    }

    const sql = 'SELECT * FROM trade.gwtrade.Compliance_Checklists';
    const checklists = await db.execute({ sqlText: sql });

    // Cache the results
    await redis.setex('all_checklists', CACHE_EXPIRATION, JSON.stringify(checklists));
    console.log('Checklists cached');

    res.json(checklists);
  } catch (error) {
    console.error('Error fetching checklists:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add a new checklist
router.post('/', async (req, res) => {
  const { title, description } = req.body;

  if (!title || !description) {
    return res.status(400).json({ message: 'Title and description are required' });
  }

  try {
    const id = uuidv4();
    const sql = `INSERT INTO trade.gwtrade.Compliance_Checklists (id, title, description, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`;
    await db.execute({ sqlText: sql, binds: [id, title, description] });

    // Clear all checklists cache
    await clearChecklistCache();

    res.status(201).json({ message: 'Checklist created successfully' });
  } catch (error) {
    console.error('Error creating checklist:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get items for a specific checklist
router.get('/:checklistId/items', async (req, res) => {
  const { checklistId } = req.params;
  const cacheKey = `checklist_items_${checklistId}`;

  try {
    // Try to get from cache first
    const cachedItems = await redis.get(cacheKey);
    if (cachedItems) {
      console.log('Serving checklist items from cache');
      return res.json(JSON.parse(cachedItems));
    }

    const sql = 'SELECT * FROM trade.gwtrade.Checklist_Items WHERE checklist_id = ?';
    const items = await db.execute({ sqlText: sql, binds: [checklistId] });

    // Cache the results
    await redis.setex(cacheKey, CACHE_EXPIRATION, JSON.stringify(items));
    console.log('Checklist items cached for:', checklistId);

    res.json(items);
  } catch (error) {
    console.error('Error fetching checklist items:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add items to a checklist
router.post('/:checklistId/items', async (req, res) => {
  const { checklistId } = req.params;
  const { item_text } = req.body;

  if (!item_text) {
    return res.status(400).json({ message: 'Item text is required' });
  }

  try {
    const id = uuidv4();
    const sql = `INSERT INTO trade.gwtrade.Checklist_Items (id, checklist_id, item_text, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`;
    await db.execute({ sqlText: sql, binds: [id, checklistId, item_text] });

    // Clear cache for this checklist's items
    await clearChecklistCache(checklistId);

    res.status(201).json({ message: 'Checklist item added successfully' });
  } catch (error) {
    console.error('Error adding checklist item:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update an item in a checklist
router.put('/items/:itemId', async (req, res) => {
  const { itemId } = req.params;
  const { is_completed } = req.body;

  try {
    // First get the checklist ID for cache clearing
    const getChecklistIdSql = 'SELECT checklist_id FROM trade.gwtrade.Checklist_Items WHERE id = ?';
    const checklistResult = await db.execute({ sqlText: getChecklistIdSql, binds: [itemId] });
    
    const sql = `UPDATE trade.gwtrade.Checklist_Items SET is_completed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    await db.execute({ sqlText: sql, binds: [is_completed, itemId] });

    // Clear cache for this checklist's items
    if (checklistResult && checklistResult[0]) {
      await clearChecklistCache(checklistResult[0].checklist_id);
    }

    res.json({ message: 'Checklist item updated successfully' });
  } catch (error) {
    console.error('Error updating checklist item:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
