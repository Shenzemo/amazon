const axios = require('axios');
// This is a placeholder for a cache implementation.
const cache = new Map();

function getCache(key) {
  return cache.get(key);
}

function setCache(key, value, ttl) {
  cache.set(key, value);
  // TTL is not implemented in this placeholder
}

module.exports = { getCache, setCache };