const axios = require('axios');
const { getCache, setCache } = require('../cache'); // Assuming a cache utility exists

const SMS_ACTIVATE_API_KEY = process.env.SMS_ACTIVATE_API_KEY;
const SMS_ACTIVATE_API_URL = 'https://api.sms-activate.org/stubs/handler_api.php';

async function fetchSmsActivatePrices() {
   const cacheKey = 'sms-activate-prices';
   const cachedData = getCache(cacheKey);
   if (cachedData) {
       return cachedData;
   }

   try {
       const response = await axios.get(SMS_ACTIVATE_API_URL, {
           params: {
               api_key: SMS_ACTIVATE_API_KEY,
               action: 'getPrices',
           },
       });

       if (response.data) {
           setCache(cacheKey, response.data, process.env.PRICE_CACHE_TTL_SECONDS);
           return response.data;
       }
       return null;
   } catch (error) {
       console.error('Error fetching from SMS-Activate:', error);
       throw new Error('Could not fetch prices from SMS-Activate');
   }
}

module.exports = { fetchSmsActivatePrices };