// routes/conversations.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Your database module
const { v4: uuidv4 } = require('uuid'); // For generating UUIDs
const authMiddleware = require('../middleware/auth'); // Authentication middleware
const authorize = require('../middleware/authorize'); // Authorization middleware
const logger = require('../utils/logger'); // Winston logger

// POST /api/conversations - Create a new conversation
router.post('/', authMiddleware, authorize(['buyer', 'seller']), async (req, res) => {
    const { participantId, productId } = req.body;
    const userId = req.user.id; // Current authenticated user
    const userRole = req.user.role; // 'buyer' or 'seller'

    if (!participantId) {
        return res.status(400).json({ message: 'Participant ID is required' });
    }

    try {
        // Fetch participant's role
        const participantResult = await db.execute({
            sqlText: `SELECT ROLE FROM USERS WHERE USER_ID = ?`,
            binds: [participantId],
        });

        if (!participantResult || participantResult.length === 0) {
            return res.status(404).json({ message: 'Participant not found' });
        }

        const participantRole = participantResult[0].ROLE;

        // Determine sender and recipient roles
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

            if ((!(hasPurchased && hasPurchased.length > 0)) && (!(hasViewed && hasViewed.length > 0))) {
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

            if ((!(buyerHasInterested && buyerHasInterested.length > 0)) && (!(buyerHasViewed && buyerHasViewed.length > 0))) {
                logger.warn(`Seller ${sellerId} attempted to initiate conversation with buyer ${buyerId} without buyer's interest.`);
                return res.status(403).json({ message: 'You can only initiate conversations with buyers who have shown interest in your products.' });
            }
        }

        // Check if a conversation already exists
        const existingConversation = await db.execute({
            sqlText: `
                SELECT CONVERSATION_ID FROM CONVERSATIONS
                WHERE SELLER_ID = ? AND BUYER_ID = ? AND 
                (${productId ? 'PRODUCT_ID = ?' : 'PRODUCT_ID IS NULL'})
                LIMIT 1
            `,
            binds: productId ? [sellerId, buyerId, productId] : [sellerId, buyerId],
        });

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
            binds: [conversationId, sellerId, buyerId, productId || null],
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
                    s.FULL_NAME AS sellerName, -- Updated column
                    c.BUYER_ID AS buyerId,
                    b.FULL_NAME AS buyerName, -- Updated column
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
