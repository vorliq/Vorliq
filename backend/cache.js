const cache = new Map();

function cacheKey(name, req) {
  const query = new URLSearchParams(req.query || {}).toString();
  return query ? `${name}?${query}` : name;
}

async function sendCachedJson(req, res, name, ttlMs, producer) {
  const key = cacheKey(name, req);
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return res.status(cached.status).json(cached.data);
  }

  const result = await producer();
  const status = result.status || 200;
  const data = result.data;
  cache.set(key, {
    status,
    data,
    expiresAt: now + ttlMs,
  });
  return res.status(status).json(data);
}

function clearCache(prefix) {
  for (const key of cache.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

module.exports = {
  clearCache,
  sendCachedJson,
};
