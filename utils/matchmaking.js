// utils/matchmaking.js

// Function to calculate similarity score between a buyer and a seller
function calculateSimilarity(buyer, seller) {
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

  // Parse and normalize seller's products offered
  let sellerProducts = seller.PRODUCTS_OFFERED;

  // Parse JSON if necessary
  if (typeof sellerProducts === 'string') {
    try {
      sellerProducts = JSON.parse(sellerProducts);
    } catch (e) {
      console.error('Error parsing seller PRODUCTS_OFFERED:', e);
      sellerProducts = [];
    }
  }

  if (!Array.isArray(sellerProducts)) {
    sellerProducts = [];
  }

  // Normalize seller products: lowercase and trim whitespace
  sellerProducts = sellerProducts.map(item => item.toLowerCase().trim());

  // Find shared products between buyer and seller
  const sharedProducts = buyerInterests.filter(product =>
    sellerProducts.includes(product)
  );

  // Calculate similarity score (e.g., number of shared products)
  const score = sharedProducts.length;

  return { score, sharedProducts };
}

// Function to find matches for a buyer from a list of sellers
exports.findMatches = (buyer, sellers) => {
  // Validate buyer data
  if (!buyer || !buyer.PRODUCT_INTERESTS) {
    throw new Error('Invalid buyer data: PRODUCT_INTERESTS is required.');
  }

  // Validate sellers data
  if (!Array.isArray(sellers)) {
    throw new Error('Invalid sellers data: Expected an array of sellers.');
  }

  const matches = sellers
    .map(seller => {
      // Validate seller data
      if (!seller || !seller.PRODUCTS_OFFERED) {
        return null;
      }

      const { score, sharedProducts } = calculateSimilarity(buyer, seller);

      if (score > 0) {
        return {
          seller_id: seller.USER_ID,
          seller_company: seller.COMPANY_NAME || 'Unknown Company',
          shared_products: sharedProducts,
          score,
        };
      } else {
        return null;
      }
    })
    .filter(match => match !== null);

  // Sort matches by score in descending order
  matches.sort((a, b) => b.score - a.score);

  return matches;
};
