const cache = new Map();

function cacheKey(name, req) {
  const query = new URLSearchParams(req.query || {}).toString();
  return query ? `${name}?${query}` : name;
}

// Send a JSON response with a short-lived server-side cache AND a matching
// browser Cache-Control header, so a quick reload or navigation reuses the
// browser's copy instead of making the round trip again. `visibility` is
// "public" for shared chain data (any visitor gets the same bytes) and "private"
// for per-user responses (e.g. a wallet balance), so a shared proxy never serves
// one member's data to another.
function setCacheControl(res, ttlMs, visibility = "public") {
  const maxAge = Math.max(0, Math.floor(ttlMs / 1000));
  res.setHeader("Cache-Control", `${visibility}, max-age=${maxAge}`);
}

async function sendCachedJson(req, res, name, ttlMs, producer, visibility = "public") {
  const key = cacheKey(name, req);
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    setCacheControl(res, cached.expiresAt - now, visibility);
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
  // Only advertise caching for successful responses; never cache an error.
  if (status >= 200 && status < 300) {
    setCacheControl(res, ttlMs, visibility);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
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
