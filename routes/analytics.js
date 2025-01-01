// routes/analytics.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Snowflake database module
const authMiddleware = require('../middleware/auth'); // Authentication middleware
const authorize = require('../middleware/authorize'); // Authorization middleware
const redis = require('../config/redis');

const CACHE_EXPIRATION = 1800; // 30 minutes for analytics data

// Helper function to clear seller analytics cache
const clearSellerAnalyticsCache = async (sellerId) => {
  try {
    await redis.del(`sales_overview_${sellerId}`);
    await redis.del(`product_performance_${sellerId}`);
    await redis.del(`time_analysis_${sellerId}`);
    console.log('Analytics cache cleared for seller:', sellerId);
  } catch (error) {
    console.error('Error clearing analytics cache:', error);
  }
};

// Sales Overview Endpoint with caching
router.get('/sales-overview', authMiddleware, authorize(['seller']), async (req, res) => {
  const sellerId = req.user.id;
  const cacheKey = `sales_overview_${sellerId}`;
  console.log(`Processing sales-overview for Seller ID: ${sellerId}`);

  try {
    // Try to get from cache first
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log('Serving sales overview from cache');
      return res.json(JSON.parse(cachedData));
    }

    // If not in cache, calculate analytics
    const totalRevenueResult = await db.execute({
      sqlText: `
        SELECT SUM(oi.PRICE * oi.QUANTITY) AS TOTAL_REVENUE
        FROM trade.gwtrade.ORDERS o
        JOIN trade.gwtrade.ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
        JOIN trade.gwtrade.PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
        WHERE p.SELLER_ID = ?
      `,
      binds: [sellerId],
    });
    console.log('Total Revenue Result:', totalRevenueResult);
    const totalRevenue = totalRevenueResult[0]?.TOTAL_REVENUE || 0;

    // Number of Orders
    const numberOfOrdersResult = await db.execute({
      sqlText: `
        SELECT COUNT(DISTINCT o.ORDER_ID) AS NUMBER_OF_ORDERS
        FROM trade.gwtrade.ORDERS o
        JOIN trade.gwtrade.ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
        JOIN trade.gwtrade.PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
        WHERE p.SELLER_ID = ?
      `,
      binds: [sellerId],
    });
    console.log('Number of Orders Result:', numberOfOrdersResult);
    const numberOfOrders = numberOfOrdersResult[0]?.NUMBER_OF_ORDERS || 0;

    // Average Order Value
    const averageOrderValueResult = await db.execute({
      sqlText: `
        SELECT AVG(order_total) AS AVERAGE_ORDER_VALUE
        FROM (
          SELECT o.ORDER_ID, SUM(oi.PRICE * oi.QUANTITY) AS order_total
          FROM trade.gwtrade.ORDERS o
          JOIN trade.gwtrade.ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
          JOIN trade.gwtrade.PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
          WHERE p.SELLER_ID = ?
          GROUP BY o.ORDER_ID
        ) sub
      `,
      binds: [sellerId],
    });
    console.log('Average Order Value Result:', averageOrderValueResult);
    const averageOrderValue = averageOrderValueResult[0]?.AVERAGE_ORDER_VALUE || 0;

    // Sales Growth
    const salesGrowthResult = await db.execute({
      sqlText: `
        SELECT
          SUM(CASE WHEN DATE_TRUNC('month', o.CREATED_AT) = DATE_TRUNC('month', CURRENT_DATE()) THEN oi.PRICE * oi.QUANTITY ELSE 0 END) AS CURRENT_MONTH_REVENUE,
          SUM(CASE WHEN DATE_TRUNC('month', o.CREATED_AT) = DATE_TRUNC('month', DATEADD('month', -1, CURRENT_DATE())) THEN oi.PRICE * oi.QUANTITY ELSE 0 END) AS PREVIOUS_MONTH_REVENUE
        FROM trade.gwtrade.ORDERS o
        JOIN trade.gwtrade.ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
        JOIN trade.gwtrade.PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
        WHERE p.SELLER_ID = ?
      `,
      binds: [sellerId],
    });
    console.log('Sales Growth Result:', salesGrowthResult);
    const currentMonthRevenue = salesGrowthResult[0]?.CURRENT_MONTH_REVENUE || 0;
    const previousMonthRevenue = salesGrowthResult[0]?.PREVIOUS_MONTH_REVENUE || 0;

    let salesGrowthPercentage = 0;
    if (previousMonthRevenue > 0) {
      salesGrowthPercentage = ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100;
    } else if (currentMonthRevenue > 0) {
      salesGrowthPercentage = 100;
    }

    const analyticsData = {
      totalRevenue,
      numberOfOrders,
      averageOrderValue,
      salesGrowthPercentage,
    };

    // Cache the results
    await redis.setex(cacheKey, CACHE_EXPIRATION, JSON.stringify(analyticsData));
    console.log('Analytics data cached for seller:', sellerId);

    res.json(analyticsData);
  } catch (error) {
    console.error('Error fetching sales overview:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Product Performance Endpoint with caching
router.get('/product-performance', authMiddleware, authorize(['seller']), async (req, res) => {
  const sellerId = req.user.id;
  const cacheKey = `product_performance_${sellerId}`;
  console.log(`Processing product-performance for Seller ID: ${sellerId}`);

  try {
    // Try cache first
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log('Serving product performance from cache');
      return res.json(JSON.parse(cachedData));
    }

    // If not in cache, fetch data
    const topSellingProductsResult = await db.execute({
      sqlText: `
        SELECT p.PRODUCT_ID, p.NAME, SUM(oi.QUANTITY) AS TOTAL_QUANTITY_SOLD
        FROM trade.gwtrade.ORDER_ITEMS oi
        JOIN trade.gwtrade.PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
        WHERE p.SELLER_ID = ?
        GROUP BY p.PRODUCT_ID, p.NAME
        ORDER BY TOTAL_QUANTITY_SOLD DESC
        LIMIT 5
      `,
      binds: [sellerId],
    });
    console.log('Top Selling Products Result:', topSellingProductsResult);
    const topSellingProducts = topSellingProductsResult;

    // Products with Low Stock
    const lowStockProductsResult = await db.execute({
      sqlText: `
        SELECT PRODUCT_ID, NAME, STOCK
        FROM trade.gwtrade.PRODUCTS
        WHERE SELLER_ID = ? AND STOCK <= 10
        ORDER BY STOCK ASC
      `,
      binds: [sellerId],
    });
    console.log('Low Stock Products Result:', lowStockProductsResult);
    const lowStockProducts = lowStockProductsResult;

    // Product Category Distribution
    const productCategoryDistributionResult = await db.execute({
      sqlText: `
        SELECT CATEGORY, COUNT(*) AS PRODUCT_COUNT
        FROM trade.gwtrade.PRODUCTS
        WHERE SELLER_ID = ?
        GROUP BY CATEGORY
      `,
      binds: [sellerId],
    });
    console.log('Product Category Distribution Result:', productCategoryDistributionResult);
    const productCategoryDistribution = productCategoryDistributionResult;

    const performanceData = {
      topSellingProducts,
      lowStockProducts,
      productCategoryDistribution,
    };

    // Cache the results
    await redis.setex(cacheKey, CACHE_EXPIRATION, JSON.stringify(performanceData));
    console.log('Product performance data cached');

    res.json(performanceData);
  } catch (error) {
    console.error('Error fetching product performance:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Time-Based Analysis Endpoint with caching
router.get('/time-based-analysis', authMiddleware, authorize(['seller']), async (req, res) => {
  const sellerId = req.user.id;
  const cacheKey = `time_analysis_${sellerId}`;
  console.log(`Processing time-based-analysis for Seller ID: ${sellerId}`);

  try {
    // Try cache first
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log('Serving time analysis from cache');
      return res.json(JSON.parse(cachedData));
    }

    // If not in cache, fetch data
    const dailySalesResult = await db.execute({
      sqlText: `
        SELECT
          DATE_TRUNC('day', o.CREATED_AT) AS DATE,
          SUM(oi.PRICE * oi.QUANTITY) AS TOTAL_REVENUE
        FROM trade.gwtrade.ORDERS o
        JOIN trade.gwtrade.ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
        JOIN trade.gwtrade.PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
        WHERE p.SELLER_ID = ?
          AND o.CREATED_AT >= DATEADD('day', -30, CURRENT_DATE())
        GROUP BY DATE_TRUNC('day', o.CREATED_AT)
        ORDER BY DATE_TRUNC('day', o.CREATED_AT)
      `,
      binds: [sellerId],
    });
    console.log('Daily Sales Result:', dailySalesResult);
    const dailySales = dailySalesResult;

    // Peak Sales Hours
    const peakSalesHoursResult = await db.execute({
      sqlText: `
        SELECT
          EXTRACT(HOUR FROM o.CREATED_AT) AS HOUR,
          SUM(oi.PRICE * oi.QUANTITY) AS TOTAL_REVENUE
        FROM trade.gwtrade.ORDERS o
        JOIN trade.gwtrade.ORDER_ITEMS oi ON o.ORDER_ID = oi.ORDER_ID
        JOIN trade.gwtrade.PRODUCTS p ON oi.PRODUCT_ID = p.PRODUCT_ID
        WHERE p.SELLER_ID = ?
          AND o.CREATED_AT >= DATEADD('day', -7, CURRENT_DATE())
        GROUP BY EXTRACT(HOUR FROM o.CREATED_AT)
        ORDER BY TOTAL_REVENUE DESC
        LIMIT 5
      `,
      binds: [sellerId],
    });
    console.log('Peak Sales Hours Result:', peakSalesHoursResult);
    const peakSalesHours = peakSalesHoursResult;

    const timeAnalysisData = {
      dailySales,
      peakSalesHours,
    };

    // Cache the results for a shorter time since it's time-sensitive data
    await redis.setex(cacheKey, 900, JSON.stringify(timeAnalysisData)); // 15 minutes cache
    console.log('Time analysis data cached');

    res.json(timeAnalysisData);
  } catch (error) {
    console.error('Error fetching time-based analysis:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Clear analytics cache when new order is placed (you'll need to call this from your orders route)
const clearAnalyticsCache = async (sellerId) => {
  try {
    await clearSellerAnalyticsCache(sellerId);
  } catch (error) {
    console.error('Error clearing analytics cache:', error);
  }
};

module.exports = router;
// If you need clearAnalyticsCache elsewhere, attach it to the router
router.clearAnalyticsCache = clearAnalyticsCache;
