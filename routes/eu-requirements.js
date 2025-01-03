const express = require('express');
const router = express.Router();
const db = require('../db');
const redis = require('../config/redis');

// Get requirements by product code or name
router.get('/eu-requirements', async (req, res) => {
    const { product } = req.query;
    const cacheKey = `eu_req_${product}`;

    try {
        // Check cache first
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
            return res.json(JSON.parse(cachedData));
        }

        // Query database
        const result = await db.execute({
            sqlText: `
                SELECT *
                FROM trade.gwtrade.eu_requirements
                WHERE LOWER(product_name) LIKE LOWER('%' || ? || '%')
                OR product_code LIKE '%' || ? || '%'
            `,
            binds: [product, product],
        });

        if (result.length === 0) {
            return res.status(404).json({ message: 'Product requirements not found' });
        }

        const requirements = result[0];

        // Cache the result
        await redis.setex(cacheKey, 3600, JSON.stringify(requirements)); // Cache for 1 hour

        res.json(requirements);
    } catch (error) {
        console.error('Error fetching EU requirements:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router; 