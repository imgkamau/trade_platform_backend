// utils/matchmaking.js

const matchmaking = {};

matchmaking.findMatches = async (buyer, db) => {
  // Validate buyer data
  if (!buyer || !buyer.PRODUCT_INTERESTS) {
    throw new Error('Invalid buyer data: PRODUCT_INTERESTS is required.');
  }

  // Parse and normalize buyer's product interests
  let buyerInterests = buyer.PRODUCT_INTERESTS;

  // Parse JSON if necessary
  if (typeof buyerInterests === 'string') {
    try {
      buyerInterests = JSON.parse(buyerInterests);
    } catch (e) {
      console.error('Error parsing buyer PRODUCT_INTERESTS:', e);
      buyerInterests = [];
    }
  }

  if (!Array.isArray(buyerInterests)) {
    buyerInterests = [];
  }

  // Normalize buyer interests: lowercase and trim whitespace
  buyerInterests = buyerInterests.map(item => item.toLowerCase().trim());

  // Fetch all products offered by sellers
  try {
    const productsResult = await db.execute({
      sqlText: `
        SELECT 
          p.SELLER_ID,
          p.NAME AS PRODUCT_NAME,
          u.COMPANY_NAME
        FROM trade.gwtrade.PRODUCTS p
        JOIN trade.gwtrade.USERS u ON p.SELLER_ID = u.USER_ID
        WHERE u.ROLE = 'seller'
      `,
    });

    const products = productsResult.rows || productsResult;

    // Map sellers to their products
    const sellerProductsMap = {};
    products.forEach(product => {
      const sellerId = product.SELLER_ID;
      if (!sellerProductsMap[sellerId]) {
        sellerProductsMap[sellerId] = {
          seller_id: sellerId,
          seller_company: product.COMPANY_NAME || 'Unknown Company',
          products_offered: [],
        };
      }
      sellerProductsMap[sellerId].products_offered.push(product.PRODUCT_NAME);
    });

    // Find matches
    const matches = Object.values(sellerProductsMap)
      .map(seller => {
        // Normalize seller products
        const sellerProducts = seller.products_offered.map(item => item.toLowerCase().trim());

        // Find shared products between buyer and seller
        const sharedProducts = buyerInterests.filter(product =>
          sellerProducts.includes(product)
        );

        // Calculate similarity score
        const score = sharedProducts.length;

        if (score > 0) {
          return {
            seller_id: seller.seller_id,
            seller_company: seller.seller_company,
            shared_products: sharedProducts,
            score,
          };
        } else {
          return null;
        }
      })
      .filter(match => match !== null)
      .sort((a, b) => b.score - a.score);

    return matches;
  } catch (error) {
    console.error('Error fetching products for matchmaking:', error);
    throw new Error('Failed to fetch seller products for matchmaking.');
  }
};

module.exports = matchmaking;
