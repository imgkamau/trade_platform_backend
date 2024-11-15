// routes/conversations.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Your database module
const { v4: uuidv4 } = require('uuid'); // For generating UUIDs
const authMiddleware = require('../middleware/auth'); // Authentication middleware
const authorize = require('../middleware/authorize'); // Authorization middleware
const logger = require('../utils/logger'); // Winston logger
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Define rate limiter for conversation creation
const conversationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many conversations created from this IP, please try again after 15 minutes.',
});

// POST /api/conversations - Create a new conversation
router.post(
    '/',
    conversationLimiter,
    authMiddleware,
    authorize(['buyer', 'seller']),
    [
        body('participantUsername')
            .isString()
            .withMessage('Participant username must be a string'),
        body('productName')
            .optional()
            .isString()
            .withMessage('Product name must be a string'),
    ],
    async (req, res) => {
        // Handle validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
        }

        const { participantUsername, productName } = req.body;
        const userId = req.user.id; // Current authenticated user
        const userRole = req.user.role; // 'buyer' or 'seller'

        if (!participantUsername) {
            return res.status(400).json({ message: 'Participant username is required' });
        }

        try {
            // Fetch participant's details based on username
            const participantResult = await db.execute({
                sqlText: `SELECT USER_ID, ROLE FROM USERS WHERE USERNAME = ?`,
                binds: [participantUsername],
            });

            if (!participantResult || participantResult.length === 0) {
                return res.status(404).json({ message: 'Participant username not found' });
            }

            const participant = participantResult[0];
            const participantId = participant.USER_ID;
            const participantRole = participant.ROLE;

            // Ensure the roles are compatible
            let sellerId, buyerId;

            if (userRole === 'seller' && participantRole === 'buyer') {
                sellerId = userId;
                buyerId = participantId;
            } else if (userRole === 'buyer' && participantRole === 'seller') {
                sellerId = participantId;
                buyerId = userId;
            } else {
                return res.status(400).json({ message: 'Invalid participant role' });
            }

            // If productName is provided, resolve to productId
            let productId = null;
            if (productName) {
                const productResult = await db.execute({
                    sqlText: `SELECT PRODUCT_ID FROM PRODUCTS WHERE NAME = ?`,
                    binds: [productName],
                });

                if (!productResult || productResult.length === 0) {
                    return res.status(404).json({ message: 'Product name not found' });
                }

                // Assuming product names are unique. If not, additional logic is needed.
                productId = productResult[0].PRODUCT_ID;
            }

            // Enforce interaction-based conversation initiation
            if (userRole === 'buyer') {
                // Buyers can only initiate conversations with sellers they've interacted with
                const hasPurchased = await db.execute({
                    sqlText: `
                        SELECT 1 FROM ORDERS o
                        JOIN ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
                        WHERE o.BUYER_ID = ? AND oi.PRODUCT_ID IN (
                            SELECT PRODUCT_ID FROM PRODUCTS WHERE SELLER_ID = ?
                        )
                        LIMIT 1
                    `,
                    binds: [buyerId, sellerId],
                });

                const hasViewed = await db.execute({
                    sqlText: `
                        SELECT 1 FROM PRODUCT_VIEWS pv
                        JOIN PRODUCTS p ON pv.PRODUCT_ID = p.PRODUCT_ID
                        WHERE pv.USER_ID = ? AND p.SELLER_ID = ?
                        LIMIT 1
                    `,
                    binds: [buyerId, sellerId],
                });

                if (
                    !(hasPurchased && hasPurchased.length > 0) &&
                    !(hasViewed && hasViewed.length > 0)
                ) {
                    logger.warn(`Buyer ${buyerId} attempted to initiate conversation with seller ${sellerId} without prior interaction.`);
                    return res.status(403).json({ message: 'You can only initiate conversations with sellers you have interacted with.' });
                }
            }

            if (userRole === 'seller') {
                // Sellers can only initiate conversations with buyers who have shown interest
                const buyerHasInterested = await db.execute({
                    sqlText: `
                        SELECT 1 FROM ORDERS o
                        JOIN ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
                        WHERE o.BUYER_ID = ? AND oi.PRODUCT_ID IN (
                            SELECT PRODUCT_ID FROM PRODUCTS WHERE SELLER_ID = ?
                        )
                        LIMIT 1
                    `,
                    binds: [buyerId, sellerId],
                });

                const buyerHasViewed = await db.execute({
                    sqlText: `
                        SELECT 1 FROM PRODUCT_VIEWS pv
                        JOIN PRODUCTS p ON pv.PRODUCT_ID = p.PRODUCT_ID
                        WHERE pv.USER_ID = ? AND p.SELLER_ID = ?
                        LIMIT 1
                    `,
                    binds: [buyerId, sellerId],
                });

                if (
                    !(buyerHasInterested && buyerHasInterested.length > 0) &&
                    !(buyerHasViewed && buyerHasViewed.length > 0)
                ) {
                    logger.warn(`Seller ${sellerId} attempted to initiate conversation with buyer ${buyerId} without buyer's interest.`);
                    return res.status(403).json({ message: 'You can only initiate conversations with buyers who have shown interest in your products.' });
                }
            }

            // Check if a conversation already exists
            let existingConversation;
            if (productId) {
                existingConversation = await db.execute({
                    sqlText: `
                        SELECT CONVERSATION_ID FROM CONVERSATIONS
                        WHERE SELLER_ID = ? AND BUYER_ID = ? AND PRODUCT_ID = ?
                        LIMIT 1
                    `,
                    binds: [sellerId, buyerId, productId],
                });
            } else {
                existingConversation = await db.execute({
                    sqlText: `
                        SELECT CONVERSATION_ID FROM CONVERSATIONS
                        WHERE SELLER_ID = ? AND BUYER_ID = ? AND PRODUCT_ID IS NULL
                        LIMIT 1
                    `,
                    binds: [sellerId, buyerId],
                });
            }

            if (existingConversation && existingConversation.length > 0) {
                logger.info(`Conversation already exists between buyer ${buyerId} and seller ${sellerId} for product ${productId || 'N/A'}.`);
                return res.status(200).json({ message: 'Conversation already exists', conversationId: existingConversation[0].CONVERSATION_ID });
            }

            // Create new conversation
            const conversationId = uuidv4();
            await db.execute({
                sqlText: `
                    INSERT INTO CONVERSATIONS (CONVERSATION_ID, SELLER_ID, BUYER_ID, PRODUCT_ID)
                    VALUES (?, ?, ?, ?)
                `,
                binds: [conversationId, sellerId, buyerId, productId],
            });

            logger.info(`Created new conversation ${conversationId} between buyer ${buyerId} and seller ${sellerId} for product ${productId || 'N/A'}.`);

            res.status(201).json({ message: 'Conversation created successfully', conversationId });
        } catch (error) {
            logger.error(`Error creating conversation: ${error.message}`);
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

// GET /api/conversations - Get all conversations for the authenticated user
router.get('/', authMiddleware, authorize(['buyer', 'seller']), async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const conversations = await db.execute({
            sqlText: `
                SELECT 
                    c.CONVERSATION_ID AS id,
                    c.SELLER_ID AS sellerId,
                    s.FULL_NAME AS sellerName,
                    c.BUYER_ID AS buyerId,
                    b.FULL_NAME AS buyerName,
                    c.PRODUCT_ID AS productId,
                    p.NAME AS productName,
                    m.CONTENT AS lastMessage,
                    m.TIMESTAMP AS lastMessageTimestamp,
                    (SELECT COUNT(*) FROM trade.gwtrade.MESSAGES m2 WHERE m2.CONVERSATION_ID = c.CONVERSATION_ID AND m2.RECIPIENT_ID = ?) AS unreadCount
                FROM trade.gwtrade.CONVERSATIONS c
                LEFT JOIN trade.gwtrade.USERS s ON c.SELLER_ID = s.USER_ID
                LEFT JOIN trade.gwtrade.USERS b ON c.BUYER_ID = b.USER_ID
                LEFT JOIN trade.gwtrade.PRODUCTS p ON c.PRODUCT_ID = p.PRODUCT_ID
                LEFT JOIN trade.gwtrade.MESSAGES m ON c.CONVERSATION_ID = m.CONVERSATION_ID AND m.TIMESTAMP = (
                    SELECT MAX(m3.TIMESTAMP) FROM trade.gwtrade.MESSAGES m3 WHERE m3.CONVERSATION_ID = c.CONVERSATION_ID
                )
                WHERE c.SELLER_ID = ? OR c.BUYER_ID = ?
                ORDER BY m.TIMESTAMP DESC
            `,
            binds: [userId, userId, userId],
        });

        // Transform data to match Conversation interface
        const formattedConversations = conversations.map(conv => ({
            id: conv.id,
            participantId: conv.sellerId === userId ? conv.buyerId : conv.sellerId,
            participantName: conv.sellerId === userId ? conv.buyerName : conv.sellerName,
            productId: conv.productId,
            productName: conv.productName,
            lastMessage: conv.lastMessage || '',
            lastMessageTimestamp: conv.lastMessageTimestamp || '',
            unreadCount: conv.unreadCount || 0,
        }));

        res.json(formattedConversations);
    } catch (error) {
        logger.error(`Error fetching conversations: ${error.message}`);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
