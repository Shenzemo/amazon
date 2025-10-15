// This script runs independently in the background, not as part of the web server.
require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Service = require('./models/Service'); // The new model

// Data helpers
const { getCountryDataByCanonicalName } = require('./country-mapper');
const servicePriority = require('./service-priority.js');

const FIVESIM_API_KEY = process.env.FIVESIM_API_KEY;
const SMS_ACTIVATE_API_KEY = process.env.SMS_ACTIVATE_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

// Use two separate rates, one for USD (for sms-activate) and one for RUB (for 5sim).
let usdToTomanRate = 0;
let rubToTomanRate = 0;

let smsActivateCountries = {};
try {
    const countriesPath = path.join(__dirname, 'sms-activate-countries.json');
    const countriesRaw = fs.readFileSync(countriesPath, 'utf8');
    smsActivateCountries = JSON.parse(countriesRaw);
    console.log("Successfully loaded sms-activate-countries.json");
} catch (error)    {
    console.error("FATAL: Could not load sms-activate-countries.json. This file is required for SMS-Activate integration.", error);
    process.exit(1);
}


const fiveSimClient = axios.create({
  baseURL: 'https://5sim.net/v1',
  headers: { 'Authorization': `Bearer ${FIVESIM_API_KEY}`, 'Accept': 'application/json' },
});

const smsActivateClient = axios.create({
    baseURL: process.env.SMSA_BASE_URL || 'https://api.sms-activate.ae/stubs/handler_api.php',
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function updateCurrencyRates() {
    try {
        const response = await axios.get('https://sarfe.erfjab.com/api/prices');
        usdToTomanRate = response.data.usd1;
        rubToTomanRate = response.data.rub1;
        console.log(`Successfully updated currency rates. USD to Toman: ${usdToTomanRate}, RUB to Toman: ${rubToTomanRate}`);
    } catch (error) {
        console.error('Failed to fetch currency rates, using fallback.', error);
        // Fallback to the .env rate if the API fails
        usdToTomanRate = parseFloat(process.env.USD_TO_TOMAN_RATE) || 58000;
        rubToTomanRate = parseFloat(process.env.RUB_TO_TOMAN_RATE) || 630;
    }
}

async function withRetry(fn, operation, retries = 3, delay = 1000, jitter = 200) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error.response && error.response.status;
      if (status === 429 || status >= 500) {
        const jitterValue = Math.random() * jitter;
        const waitTime = delay * Math.pow(2, i) + jitterValue;
        console.warn(`[${operation}] Attempt ${i + 1} failed with status ${status}. Retrying in ${waitTime.toFixed(0)}ms...`);
        await sleep(waitTime);
      } else {
        console.error(`[${operation}] Failed with unrecoverable error:`, error.message);
        throw error;
      }
    }
  }
  console.error(`[${operation}] All retries failed.`);
  throw lastError;
}

async function runUpdate() {
  console.log('Starting service update process...');

  try {
    await updateCurrencyRates(); // Fetch latest currency rates before processing
    await mongoose.connect(MONGO_URI);
    console.log('Database connected.');

    const [fiveSimData, smsActivateServicesData] = await Promise.all([
        withRetry(() => fiveSimClient.get('/guest/prices'), '5sim-prices').then(r => r.data),
        fetchSmsActivatePrices(smsActivateCountries)
    ]);

    console.log('Successfully fetched data from all providers.');

    const allServicesRaw = [];
    // 5sim processing
    for (const countryName in fiveSimData) {
        for (const serviceName in fiveSimData[countryName]) {
            const details = fiveSimData[countryName][serviceName];
            if (details && typeof details.cost !== 'undefined') {
                allServicesRaw.push({ provider: '5sim', country: countryName, service: serviceName, operator: 'any', price: details.cost, count: details.count, rate: details.rate || 0 });
            } else {
                for (const operatorName in details) {
                    const opDetails = details[operatorName];
                    allServicesRaw.push({ provider: '5sim', country: countryName, service: serviceName, operator: operatorName, price: opDetails.cost, count: opDetails.count, rate: opDetails.rate || 0 });
                }
            }
        }
    }
    console.log(`Processed ${allServicesRaw.length} services from 5sim.`);
    allServicesRaw.push(...smsActivateServicesData);
    console.log(`Total raw services from all providers: ${allServicesRaw.length}.`);

    // What was changed and why:
    // This logic has been rewritten to be more robust. Instead of relying on a simple array concatenation,
    // we now use a Map to explicitly group all provider options for each unique service/country combination.
    // This guarantees that if both 5sim and SMS Activate offer the same service, both are included in the final
    // list, resolving the issue where some services appeared to be dropped.
    const serviceMap = new Map();
    let unknownServiceCodes = new Set();

    for (const s of allServicesRaw) {
        const cleanServiceCode = s.service.toLowerCase().trim();
        const cleanCountry = s.country.toLowerCase().trim();
        let canonicalEnglishName = s.service_name || s.service;
        if (!canonicalEnglishName) {
            unknownServiceCodes.add(s.service);
            continue; // Skip services without a name
        }

        const canonicalKeyFromName = canonicalEnglishName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const priorityInfo = servicePriority[canonicalKeyFromName] || servicePriority[cleanServiceCode];
        let servicePersian = priorityInfo?.name;

        if (!servicePersian) {
            servicePersian = canonicalEnglishName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            if (!priorityInfo) {
              unknownServiceCodes.add(s.service);
            }
        }
        const countryData = getCountryDataByCanonicalName(cleanCountry);
        if (!countryData) continue; // Skip services with unmappable countries

        let basePriceToman;
        if (s.provider === 'sms-activate') {
            basePriceToman = (Number(s.price) || 0) * usdToTomanRate;
        } else { // 5sim
            basePriceToman = (Number(s.price) || 0) * rubToTomanRate;
        }
        
        if (basePriceToman <= 0) continue; // Skip services that are free or have invalid prices

        const finalPriceToman = Math.ceil(basePriceToman * 1.4);

        const formattedService = {
            id: `srv_${cleanServiceCode}_${cleanCountry}_${s.operator}_${s.provider}`,
            service: s.service,
            service_persian: servicePersian,
            country: s.country,
            country_persian: countryData.persian,
            country_code: countryData.code,
            operator: s.operator,
            price_toman: finalPriceToman,
            priority: priorityInfo?.priority || 999,
            available: s.count > 0,
            success_rate: s.rate || 0,
            provider: s.provider,
        };
        
        // Use a composite key to group by the core service and country
        const mapKey = `${formattedService.service_persian}_${formattedService.country_persian}`;
        if (!serviceMap.has(mapKey)) {
            serviceMap.set(mapKey, []);
        }
        serviceMap.get(mapKey).push(formattedService);
    }
    
    // Flatten the map values to get the final, complete list of services
    const formattedServices = Array.from(serviceMap.values()).flat();

    if (unknownServiceCodes.size > 0) {
      console.warn(`[Observability] Found ${unknownServiceCodes.size} unknown service codes.`);
    }
    console.log(`Formatted ${formattedServices.length} valid services for database update.`);

    // Use atomic update to prevent race conditions
    const TempService = mongoose.model('Service_temp', Service.schema);
    await TempService.deleteMany({});
    console.log('Cleared temporary collection.');
    
    await TempService.insertMany(formattedServices, { ordered: false });
    console.log('Bulk inserted data into temporary collection.');

    // Atomically swap the collections
    await mongoose.connection.db.dropCollection('services').catch(err => {
        if (err.code !== 26) console.error("Error dropping 'services' collection:", err); // 26 = NamespaceNotFound
    });
    console.log('Dropped old services collection (if it existed).');
    await mongoose.connection.db.renameCollection('service_temps', 'services');
    console.log('Renamed temporary collection to services.');

    const finalCount = await Service.countDocuments();
    console.log(`[Observability] Final DB count: ${finalCount}`);
    console.log('✅ Database update complete!');

  } catch (error) {
    console.error('❌ An error occurred during the service update process:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database disconnected. Script finished.');
  }
}

async function fetchSmsActivatePrices(countries) {
    const servicesResponse = await withRetry(() => smsActivateClient.get('', { params: { api_key: SMS_ACTIVATE_API_KEY, action: 'getServicesList' } }), 'sms-services');
    if (servicesResponse.data.status !== 'success') {
        throw new Error('Could not fetch SMS Activate services list.');
    }
    const services = servicesResponse.data.services;
    const allSmsServices = [];

    for (const service of services) {
        try {
            const priceResponse = await withRetry(() => smsActivateClient.get('', { params: { api_key: SMS_ACTIVATE_API_KEY, action: 'getTopCountriesByService', service: service.code } }), `sms-prices-${service.code}`);
            const prices = priceResponse.data;

            for (const countryId in prices) {
                const countryData = prices[countryId];
                const countryName = countries[countryId];
                if (countryName) {
                    allSmsServices.push({
                        provider: 'sms-activate',
                        country: countryName,
                        service: service.code,
                        service_name: service.name,
                        operator: 'any',
                        price: countryData.retail_price,
                        count: countryData.count,
                        rate: 0,
                    });
                }
            }
        } catch (error) {
            console.error(`Could not fetch prices for service ${service.code}: ${error.message}`);
        }
    }
    console.log(`Processed ${allSmsServices.length} services from sms-activate.`);
    return allSmsServices;
}


runUpdate();
