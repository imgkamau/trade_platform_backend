const express = require('express');
const router = express.Router();
const db = require('../db');

// Get requirements by product code or name
router.get('/eu-requirements', async (req, res) => {
    const { product } = req.query;

    try {
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
        res.json(requirements);
    } catch (error) {
        console.error('Error fetching EU requirements:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router; 