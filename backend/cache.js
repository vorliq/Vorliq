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

  // Cache expired (or empty): refresh from the producer. If the producer is slow
  // or fails — which happens when the Flask core is briefly busy persisting a
  // mined block under its write lock — serve the LAST good value (stale) rather
  // than hanging or returning an error. The frontend gets data immediately; only
  // a cold cache with a failing producer surfaces the error.
  let result;
  try {
    result = await producer();
  } catch (error) {
    if (cached) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Vorliq-Stale", "1");
      return res.status(cached.status).json(cached.data);
    }
    throw error;
  }
  const status = result.status || 200;
  const data = result.data;
  // Only cache (and advertise caching for) successful responses; never cache an
  // error, and if a producer error came back as a non-2xx, fall back to stale.
  if (status >= 200 && status < 300) {
    cache.set(key, { status, data, expiresAt: now + ttlMs });
    setCacheControl(res, ttlMs, visibility);
    return res.status(status).json(data);
  }
  if (cached) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Vorliq-Stale", "1");
    return res.status(cached.status).json(cached.data);
  }
  res.setHeader("Cache-Control", "no-store");
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
