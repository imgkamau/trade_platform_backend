// utils/matchmaking.js

// Enhanced matchmaking algorithm
async function findMatches(userId, db) {
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  console.log('Finding matches for buyer:', userId);

  const matchQuery = `
    WITH buyer AS (
      SELECT 
        USER_ID,
        PRODUCT_INTERESTS
      FROM trade.gwtrade.BUYERS
      WHERE USER_ID = ?
      AND ARRAY_SIZE(PRODUCT_INTERESTS) > 0
    )
    SELECT DISTINCT
      s.USER_ID as SELLER_ID,
      u.FULL_NAME as COMPANY_NAME,
      s.PRODUCTS_OFFERED as PRODUCT_CATEGORIES,
      s.LOCATION,
      s.YEARS_OF_EXPERIENCE,
      s.TARGET_MARKETS,
      b.PRODUCT_INTERESTS as BUYER_INTERESTS,
      ARRAY_INTERSECTION(
        s.PRODUCTS_OFFERED,
        b.PRODUCT_INTERESTS
      ) as MATCHING_PRODUCTS,
      ARRAY_SIZE(ARRAY_INTERSECTION(
        s.PRODUCTS_OFFERED,
        b.PRODUCT_INTERESTS
      )) as MATCH_COUNT
    FROM trade.gwtrade.SELLERS s
    JOIN trade.gwtrade.USERS u ON s.USER_ID = u.USER_ID
    CROSS JOIN buyer b
    WHERE s.PRODUCTS_OFFERED IS NOT NULL
    AND ARRAY_SIZE(ARRAY_INTERSECTION(
      s.PRODUCTS_OFFERED,
      b.PRODUCT_INTERESTS
    )) > 0
    ORDER BY MATCH_COUNT DESC`;

  try {
    console.log('Executing matchmaking query...');
    const result = await db.execute({ 
      sqlText: matchQuery,
      binds: [userId]
    });

    // Access the raw result directly if rows is not available
    const resultRows = Array.isArray(result) ? result : (result.rows || []);
    
    console.log('Result rows:', resultRows.length);

    if (resultRows.length === 0) {
      console.log('No matches found, returning empty array');
      return { matches: [] };
    }

    const matches = resultRows.map(seller => ({
      SELLER_ID: seller.SELLER_ID,
      COMPANY_NAME: seller.COMPANY_NAME,
      MATCH_SCORE: Math.round((seller.MATCH_COUNT / seller.BUYER_INTERESTS.length) * 100),
      PRODUCT_CATEGORIES: seller.PRODUCT_CATEGORIES,
      MATCHING_PRODUCTS: seller.MATCHING_PRODUCTS,
      YEARS_OF_EXPERIENCE: seller.YEARS_OF_EXPERIENCE || 0,
      LOCATION: seller.LOCATION,
      TARGET_MARKETS: seller.TARGET_MARKETS || []
    }));

    console.log('Processed matches:', JSON.stringify(matches, null, 2));
    return { matches };
  } catch (error) {
    console.error('Error executing matchmaking query:', error);
    throw error;
  }
}

function normalizeBuyerInterests(interests) {
  try {
    let parsed = interests;
    if (typeof interests === 'string') {
      parsed = JSON.parse(interests);
    }
    return Array.isArray(parsed) 
      ? parsed.map(item => item.toLowerCase().trim())
      : [];
  } catch (e) {
    console.error('Error parsing buyer interests:', e);
    return [];
  }
}

async function fetchSellersData(db) {
  const query = `
    SELECT DISTINCT
      s.USER_ID as SELLER_ID,
      u.FULL_NAME as COMPANY_NAME,
      s.PRODUCTS_OFFERED,
      s.LOCATION,
      s.YEARS_OF_EXPERIENCE,
      s.TARGET_MARKETS,
      s.CERTIFICATIONS
    FROM trade.gwtrade.SELLERS s
    JOIN trade.gwtrade.USERS u ON s.USER_ID = u.USER_ID
    WHERE s.PRODUCTS_OFFERED IS NOT NULL
      AND ARRAY_SIZE(PARSE_JSON(s.PRODUCTS_OFFERED)) > 0
  `;

  const result = await db.execute({ sqlText: query });
  console.log('Raw sellers query result:', JSON.stringify(result.rows, null, 2));
  return result.rows || [];
}

function processSellerData(rawData) {
  const sellersMap = new Map();

  rawData.forEach(row => {
    if (!sellersMap.has(row.SELLER_ID)) {
      sellersMap.set(row.SELLER_ID, {
        seller_id: row.SELLER_ID,
        company_name: row.COMPANY_NAME || 'Unknown Company',
        years_experience: row.YEARS_OF_EXPERIENCE || 0,
        average_rating: row.AVERAGE_RATING || 0,
        products_offered: [],
        performance_metrics: {
          total_orders: row.TOTAL_ORDERS || 0,
          successful_orders: row.SUCCESSFUL_ORDERS || 0,
          avg_response_time: row.AVG_RESPONSE_TIME || 0
        }
      });
    }
    sellersMap.get(row.SELLER_ID).products_offered.push(row.PRODUCT_NAME.toLowerCase().trim());
  });

  return Array.from(sellersMap.values());
}

function calculateMatchScore(buyerInterests, sellerProducts) {
  try {
    const matchingProducts = sellerProducts.filter(product =>
      buyerInterests.some(interest => 
        interest.toLowerCase() === product.toLowerCase()
      )
    );
    const matchPercentage = Math.round((matchingProducts.length / buyerInterests.length) * 100);
    return Math.min(matchPercentage, 100);
  } catch (error) {
    console.error('Error calculating match score:', error);
    return 0;
  }
}

// Helper function to parse array fields
function parseArrayField(field) {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  try {
    return JSON.parse(field);
  } catch {
    return [];
  }
}

module.exports = findMatches;
