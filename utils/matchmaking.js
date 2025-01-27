// utils/matchmaking.js

// Enhanced matchmaking algorithm
async function findMatches(userId, db) {
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  console.log('Finding matches for buyer:', userId);
  
  const query = `
    WITH buyer AS (
      SELECT DISTINCT
        USER_ID,
        PRODUCT_INTERESTS,
        LOCATION
      FROM trade.gwtrade.BUYERS
      WHERE USER_ID = ?
      AND PRODUCT_INTERESTS IS NOT NULL
      AND ARRAY_SIZE(PRODUCT_INTERESTS) > 0
      LIMIT 1
    ),
    seller_products AS (
      SELECT 
        s.USER_ID,
        u.FULL_NAME,
        ARRAY_AGG(s.PRODUCTS_OFFERED) as ALL_PRODUCTS,
        s.LOCATION,
        s.YEARS_OF_EXPERIENCE,
        s.TARGET_MARKETS
      FROM trade.gwtrade.SELLERS s
      JOIN trade.gwtrade.USERS u ON s.USER_ID = u.USER_ID
      WHERE s.PRODUCTS_OFFERED IS NOT NULL
      GROUP BY s.USER_ID, u.FULL_NAME, s.LOCATION, s.YEARS_OF_EXPERIENCE, s.TARGET_MARKETS
    )
    SELECT DISTINCT
      sp.USER_ID as SELLER_ID,
      sp.FULL_NAME as COMPANY_NAME,
      sp.ALL_PRODUCTS as PRODUCT_CATEGORIES,
      sp.LOCATION,
      sp.YEARS_OF_EXPERIENCE,
      sp.TARGET_MARKETS,
      b.PRODUCT_INTERESTS as BUYER_INTERESTS,
      ARRAY_INTERSECTION(
        ARRAY_FLATTEN(sp.ALL_PRODUCTS),
        b.PRODUCT_INTERESTS
      ) as MATCHING_PRODUCTS,
      ARRAY_SIZE(ARRAY_INTERSECTION(
        ARRAY_FLATTEN(sp.ALL_PRODUCTS),
        b.PRODUCT_INTERESTS
      )) as MATCH_COUNT
    FROM seller_products sp
    CROSS JOIN buyer b
    WHERE ARRAY_SIZE(ARRAY_INTERSECTION(
      ARRAY_FLATTEN(sp.ALL_PRODUCTS),
      b.PRODUCT_INTERESTS
    )) > 0`;

  try {
    console.log('Executing matchmaking query...');
    const result = await db.execute({ 
      sqlText: query,
      binds: [userId]
    });

    console.log('Raw query result:', JSON.stringify(result.rows, null, 2));
    console.log('Number of rows returned:', result.rows?.length || 0);

    if (!result.rows || result.rows.length === 0) {
      console.log('No matches found, returning empty array');
      return { matches: [] };
    }

    const matches = result.rows.map(seller => ({
      SELLER_ID: seller.SELLER_ID,
      COMPANY_NAME: seller.COMPANY_NAME,
      MATCH_SCORE: (seller.MATCH_COUNT / seller.BUYER_INTERESTS.length) * 100,
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
