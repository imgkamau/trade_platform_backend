// routes/users.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Your database module
const authMiddleware = require('../middleware/auth'); // Authentication middleware
const authorize = require('../middleware/authorize'); // Authorization middleware
const logger = require('../utils/logger'); // Winston logger

// GET /api/users/search?query=searchTerm
router.get('/search', authMiddleware, authorize(['buyer', 'seller']), async (req, res) => {
    const { query } = req.query;

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ message: 'Query parameter is required and must be a string.' });
    }

    try {
        const users = await db.execute({
            sqlText: `
                SELECT USERNAME, FULL_NAME 
                FROM trade.gwtrade.USERS 
                WHERE USERNAME ILIKE ? OR FULL_NAME ILIKE ?
                LIMIT 10
            `,
            binds: [`%${query}%`, `%${query}%`],
        });

        res.json(users);
    } catch (error) {
        logger.error(`Error searching users: ${error.message}`);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
