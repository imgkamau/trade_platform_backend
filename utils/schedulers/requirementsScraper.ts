import cron from 'node-cron';
import scraper from '../scrapers/access2markets';

const KENYAN_EXPORT_HS_CODES = [
  '0901', // Coffee
  '0902', // Tea
  '0603', // Cut flowers
  '0804.40', // Avocados
  // Add more HS codes as needed
];

export const scheduleRequirementsScraping = () => {
  // Run every day at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('Starting daily EU requirements update...');
    
    for (const hsCode of KENYAN_EXPORT_HS_CODES) {
      try {
        const requirements = await scraper.scrapeProduct(hsCode);
        await scraper.updateDatabase(requirements);
        console.log(`Updated requirements for ${hsCode}`);
      } catch (error) {
        console.error(`Failed to update ${hsCode}:`, error);
      }
    }
  });
}; 