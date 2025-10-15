// sanity_check.js
require('dotenv').config();
const axios = require('axios');

console.log("--- SANITY CHECK SCRIPT START ---");

// 1. Check the Environment Variable
const apiKey = process.env.FIVESIM_API_KEY;

if (apiKey && apiKey.length > 10) {
  // We log a masked version so you don't expose your full key
  console.log(`✅ API Key FOUND. It starts with: ${apiKey.substring(0, 4)} and ends with: ${apiKey.substring(apiKey.length - 4)}`);
} else {
  console.error("❌ CRITICAL: API Key is NOT FOUND or is invalid in this Node.js environment!");
}

// 2. Make a simple, free API Call to check the key
async function runTest() {
  if (!apiKey) {
    console.log("Skipping API call because key is missing.");
    console.log("--- SANITY CHECK SCRIPT END ---");
    return;
  }

  console.log("Attempting API call to /user/profile with the key found...");
  try {
    const response = await axios.get(
      'https://5sim.net/v1/user/profile', // Using a simple profile endpoint for the test
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        }
      }
    );
    console.log("✅ API Call SUCCEEDED. Your profile data:");
    console.log(response.data);
  } catch (error) {
    console.error("❌ API Call FAILED.");
    if (error.response) {
      console.error('Status Code:', error.response.status);
      console.error('Response Data:', error.response.data);
    } else {
      console.error('Error Message:', error.message);
    }
  }
  console.log("--- SANITY CHECK SCRIPT END ---");
}

runTest();
