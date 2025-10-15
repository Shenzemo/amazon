const cache = new Map();

function setCache(key, value, ttlSeconds) {
   if (!ttlSeconds) {
       // Default to 10 minutes if not provided
       ttlSeconds = 600;
   }
   const expiration = Date.now() + ttlSeconds * 1000;
   cache.set(key, { value, expiration });
}

function getCache(key) {
   const cached = cache.get(key);
   if (cached && Date.now() < cached.expiration) {
       return cached.value;
   }
   // Purge expired cache entry
   cache.delete(key);
   return null;
}

module.exports = { setCache, getCache };