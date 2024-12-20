// utils/matchmaking.js

// Enhanced matchmaking algorithm
async function findMatches(buyer, db) {
  console.log('Matchmaking.findMatches called');
  
  if (!buyer || !buyer.PRODUCT_INTERESTS) {
    console.error('Invalid buyer data: PRODUCT_INTERESTS is required.');
    throw new Error('Invalid buyer data: PRODUCT_INTERESTS is required.');
  }

  // Parse and normalize buyer interests
  let buyerInterests = normalizeBuyerInterests(buyer.PRODUCT_INTERESTS);
  console.log('Normalized buyer interests:', buyerInterests);

  try {
    // Fetch sellers with detailed information
    const sellersData = await fetchSellersData(db);
    console.log(`Fetched data for ${sellersData.length} sellers`);

    // Calculate matches with weighted scoring
    const matches = calculateMatches(buyerInterests, sellersData);
    
    return matches;
  } catch (error) {
    console.error('Error in matchmaking process:', error);
    throw new Error('Failed to complete matchmaking process.');
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
    SELECT 
      u.USER_ID as SELLER_ID,
      u.COMPANY_NAME,
      u.YEARS_OF_EXPERIENCE,
      u.AVERAGE_RATING,
      p.NAME as PRODUCT_NAME,
      COUNT(o.ORDER_ID) as TOTAL_ORDERS,
      AVG(DATEDIFF('HOUR', o.CREATED_AT, o.UPDATED_AT)) as AVG_RESPONSE_TIME,
      COUNT(CASE WHEN o.STATUS = 'Completed' THEN 1 END) as SUCCESSFUL_ORDERS
    FROM trade.gwtrade.USERS u
    JOIN trade.gwtrade.PRODUCTS p ON p.SELLER_ID = u.USER_ID
    LEFT JOIN trade.gwtrade.ORDERS o ON o.SELLER_ID = u.USER_ID
    WHERE u.ROLE = 'seller' AND u.IS_ACTIVE = true
    GROUP BY u.USER_ID, u.COMPANY_NAME, u.YEARS_OF_EXPERIENCE, u.AVERAGE_RATING, p.NAME
  `;

  const result = await db.execute({ sqlText: query });
  return processSellerData(result.rows || result);
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

function calculateMatches(buyerInterests, sellers) {
  const matches = sellers.map(seller => {
    const matchScore = calculateMatchScore(buyerInterests, seller);
    
    if (matchScore.total > 0) {
      return {
        seller_id: seller.seller_id,
        seller_company: seller.company_name,
        match_details: {
          product_match_score: matchScore.productScore,
          experience_score: matchScore.experienceScore,
          performance_score: matchScore.performanceScore,
          total_score: matchScore.total
        },
        shared_products: matchScore.sharedProducts,
        performance_metrics: {
          success_rate: (seller.performance_metrics.successful_orders / 
                        Math.max(seller.performance_metrics.total_orders, 1) * 100).toFixed(1),
          avg_response_time: seller.performance_metrics.avg_response_time.toFixed(1),
          total_orders: seller.performance_metrics.total_orders
        }
      };
    }
    return null;
  })
  .filter(match => match !== null)
  .sort((a, b) => b.match_details.total_score - a.match_details.total_score);

  return matches;
}

function calculateMatchScore(buyerInterests, seller) {
  // Product matching
  const sharedProducts = buyerInterests.filter(product =>
    seller.products_offered.includes(product)
  );
  const productScore = (sharedProducts.length / Math.max(buyerInterests.length, 1)) * 0.5;

  // Experience score (max 10 years considered optimal)
  const experienceScore = Math.min(seller.years_experience / 10, 1) * 0.25;

  // Performance score
  const performanceScore = calculatePerformanceScore(seller.performance_metrics) * 0.25;

  return {
    productScore,
    experienceScore,
    performanceScore,
    total: productScore + experienceScore + performanceScore,
    sharedProducts
  };
}

function calculatePerformanceScore(metrics) {
  if (metrics.total_orders === 0) return 0;

  const successRate = metrics.successful_orders / metrics.total_orders;
  const responseScore = Math.max(0, 1 - (metrics.avg_response_time / 48)); // 48 hours baseline
  
  return (successRate * 0.6) + (responseScore * 0.4);
}

module.exports = findMatches;
