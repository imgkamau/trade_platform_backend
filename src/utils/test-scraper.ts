import scraper from '../../utils/scrapers/access2markets';

async function testScraper() {
  const products = [
    { code: '0901', name: 'Coffee' },
    { code: '0902', name: 'Tea' },
    { code: '0603', name: 'Flowers' }
  ];

  console.log('Starting scraper test...');

  for (const product of products) {
    try {
      console.log(`\nScraping ${product.name} (HS: ${product.code})...`);
      
      const requirements = await scraper.scrapeProduct(product.code);
      console.log('Scraped Data:', JSON.stringify(requirements, null, 2));
      
      await scraper.updateDatabase(requirements);
      console.log(`Successfully updated database for ${product.name}`);
      
    } catch (error: any) {
      console.error(`Error with ${product.name}:`, error?.message || 'Unknown error');
    }
  }
}

testScraper(); 