const smsActivateCountries = require('./sms-activate-countries.json');
const countryTranslations = require('./translations');
const countryCodes = require('./country-codes');

const unifiedCountryMap = new Map();

function generateCanonicalName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Process sms-activate countries first
for (const id in smsActivateCountries) {
    const name = smsActivateCountries[id];
    const canonicalName = generateCanonicalName(name);
    
    // Find corresponding Persian name and code from our existing files
    const persianName = countryTranslations[canonicalName];
    const code = countryCodes[canonicalName];
    
    if (persianName && code) {
        unifiedCountryMap.set(canonicalName, {
            persian: persianName,
            code: code,
            original: name
        });
    }
}

// Add any missing countries from our own translations list
for (const key in countryTranslations) {
    const canonicalName = generateCanonicalName(key);
    if (!unifiedCountryMap.has(canonicalName)) {
        const code = countryCodes[canonicalName];
        if (code) {
            unifiedCountryMap.set(canonicalName, {
                persian: countryTranslations[key],
                code: code,
                original: key
            });
        }
    }
}

function getCountryDataByCanonicalName(name) {
    const canonicalName = generateCanonicalName(name);
    return unifiedCountryMap.get(canonicalName);
}

module.exports = {
    getCountryDataByCanonicalName,
    unifiedCountryMap
};
