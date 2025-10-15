const axios = require('axios');
const { getCache, setCache } = require('../cache'); // Assuming a cache utility exists

const SARFE_API_URL = process.env.SARFE_API_URL || 'https://sarfe.erfjab.com/api/prices';
const PROFIT_MARGIN = parseFloat(process.env.PROFIT_MARGIN) || 0.4;
const ROUNDING_PRECISION = parseInt(process.env.ROUNDING_PRECISION, 10) || 100;

async function getConversionRates() {
   const cacheKey = 'sarfe-rates';
   const cachedData = getCache(cacheKey);
   if (cachedData) {
       return cachedData;
   }

   try {
       const response = await axios.get(SARFE_API_URL);
       if (response.data) {
           setCache(cacheKey, response.data, process.env.PRICE_CACHE_TTL_SECONDS);
           return response.data;
       }
       return null;
   } catch (error) {
       console.error('Error fetching from Sarfe:', error);
       const cachedRates = getCache(cacheKey);
       if (cachedRates) return cachedRates;
       throw new Error('Price conversion currently unavailable—please try again later');
   }
}

function convertToToman(price, currency, rates) {
   let rate;
   switch (currency) {
       case 'RUB':
           rate = rates.rub;
           break;
       case 'USD':
           rate = rates.usd;
           break;
       default:
           rate = 1;
   }

   const convertedPrice = price * rate;
   const finalPrice = Math.ceil((convertedPrice * (1 + PROFIT_MARGIN)) / ROUNDING_PRECISION) * ROUNDING_PRECISION;
   return finalPrice;
}

module.exports = { getConversionRates, convertToToman };