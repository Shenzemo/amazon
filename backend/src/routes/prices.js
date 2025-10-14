const express = require('express');
const router = express.Router();
const { fetchSmsActivatePrices } = require('../services/smsActivateClient');
const { getConversionRates, convertToToman } = require('../services/priceConverter');

router.get('/retail', async (req, res) => {
   try {
       const [smsPrices, rates] = await Promise.all([
           fetchSmsActivatePrices(),
           getConversionRates(),
       ]);

       if (!smsPrices || !rates) {
           return res.status(503).json({ message: 'Price conversion currently unavailable—please try again later' });
       }

       const retailPrices = {};
       for (const country in smsPrices) {
           retailPrices[country] = {};
           for (const service in smsPrices[country]) {
               const originalPrice = smsPrices[country][service].cost;
               const currency = 'RUB'; // Assuming RUB from SMS-Activate, adjust if needed
               retailPrices[country][service] = {
                   final_price_toman: convertToToman(originalPrice, currency, rates),
                   last_updated: new Date().toISOString(),
               };
           }
       }

       res.json(retailPrices);
   } catch (error) {
       res.status(503).json({ message: error.message });
   }
});

module.exports = router;