import axios from 'axios';
import * as cheerio from 'cheerio';
import rateLimit from 'axios-rate-limit';
//import type { Root } from 'cheerio';
//import { db } from '../../db';
const db = require('../../db');

interface ProductRequirement {
  id: string;
  productCode: string;
  productName: string;
  technicalRequirements: string[];
  safetyRequirements: string[];
  labelingRequirements: string[];
  certificationRequirements: string[];
  tariffRate: number;
  tariffConditions: string[];
}

class Access2MarketsScraper {
  private baseUrl = 'https://trade.ec.europa.eu/access-to-markets/en/non-eu-markets/ke/eu';
  private http;

  constructor() {
    const axiosInstance = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cookie': 'cookiePolicy=true; _pk_id=1',
        'Cache-Control': 'max-age=0',
        'Referer': 'https://trade.ec.europa.eu/access-to-markets/en/home',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1'
      },
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 500; // Accept all responses to handle them manually
      }
    });

    this.http = rateLimit(axiosInstance, { 
      maxRequests: 1,
      perMilliseconds: 3000,  // More conservative timing
      maxRPS: 0.3
    });
  }
  
  async scrapeProduct(hsCode: string): Promise<ProductRequirement> {
    try {
      await this.delay(3000);

      const productUrl = `${this.baseUrl}/product/${hsCode}`;
      console.log('Attempting to fetch:', productUrl);
      
      const response = await this.http.get(productUrl);
      console.log('Response status:', response.status);
      console.log('Response URL:', response.config?.url);
      
      if (response.status !== 200) {
        console.log('Response data:', response.data);
        throw new Error(`Request failed with status ${response.status}`);
      }

      const $ = cheerio.load(response.data);

      // Extract data using CSS selectors (you'll need to adjust these based on the actual website structure)
      const requirements = {
        id: `${hsCode}-${Date.now()}`,
        productCode: hsCode,
        productName: $('.product-name').text().trim(),
        technicalRequirements: this.extractRequirements($, '.technical-requirements'),
        safetyRequirements: this.extractRequirements($, '.safety-requirements'),
        labelingRequirements: this.extractRequirements($, '.labeling-requirements'),
        certificationRequirements: this.extractRequirements($, '.certification-requirements'),
        tariffRate: this.extractTariffRate($),
        tariffConditions: this.extractRequirements($, '.tariff-conditions')
      };

      return requirements;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        // Handle rate limit exceeded
        console.log('Rate limit exceeded, waiting 60 seconds...');
        await this.delay(60000); // Wait 1 minute
        return this.scrapeProduct(hsCode); // Retry
      }
      console.error(`Error scraping product ${hsCode}:`, error);
      throw error;
    }
  }

  private extractRequirements($: any, selector: string): string[] {
    const requirements: string[] = [];
    $(selector).find('li').each(function(this: any, _index: number, element: any) {
      requirements.push($(element).text().trim());
    });
    return requirements;
  }

  private extractTariffRate($: any): number {
    const rateText = $('.tariff-rate').text().trim();
    return parseFloat(rateText) || 0;
  }

  async updateDatabase(requirements: ProductRequirement): Promise<void> {
    try {
      await db.execute({
        sqlText: `
          MERGE INTO trade.gwtrade.eu_requirements target
          USING (SELECT
            ? as id,
            ? as product_code,
            ? as product_name,
            PARSE_JSON(?) as technical_requirements,
            PARSE_JSON(?) as safety_requirements,
            PARSE_JSON(?) as labeling_requirements,
            PARSE_JSON(?) as certification_requirements,
            ? as tariff_rate,
            PARSE_JSON(?) as tariff_conditions
          ) source
          ON target.product_code = source.product_code
          WHEN MATCHED THEN
            UPDATE SET
              technical_requirements = source.technical_requirements,
              safety_requirements = source.safety_requirements,
              labeling_requirements = source.labeling_requirements,
              certification_requirements = source.certification_requirements,
              tariff_rate = source.tariff_rate,
              tariff_conditions = source.tariff_conditions,
              updated_at = CURRENT_TIMESTAMP()
          WHEN NOT MATCHED THEN
            INSERT (id, product_code, product_name, technical_requirements, safety_requirements, 
                   labeling_requirements, certification_requirements, tariff_rate, tariff_conditions)
            VALUES (source.id, source.product_code, source.product_name, source.technical_requirements,
                   source.safety_requirements, source.labeling_requirements, source.certification_requirements,
                   source.tariff_rate, source.tariff_conditions)
        `,
        binds: [
          requirements.id,
          requirements.productCode,
          requirements.productName,
          JSON.stringify(requirements.technicalRequirements),
          JSON.stringify(requirements.safetyRequirements),
          JSON.stringify(requirements.labelingRequirements),
          JSON.stringify(requirements.certificationRequirements),
          requirements.tariffRate,
          JSON.stringify(requirements.tariffConditions)
        ]
      });
    } catch (error) {
      console.error('Error updating database:', error);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new Access2MarketsScraper(); 