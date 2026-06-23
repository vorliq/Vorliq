const path = require("path");

const { atomicWriteJson, safeReadJson } = require("./jsonStore");

// A shared, cross-worker store for express-rate-limit, backed by the same
// lightweight JSON file pattern used for the faucet abuse defences. The default
// MemoryStore is per-process, so on a multi-worker deployment a client can
// multiply its allowance by the number of workers; this store keeps the counters
// in one file every worker reads and writes, so the limits are enforced globally.
//
// This is not Redis and it is not perfect under extreme concurrency (two workers
// can read-modify-write the same counter in the same instant and lose one hit),
// but it closes the multi-worker bypass for the request volumes these (write/
// abuse) endpoints see, and it is only wired to those endpoints — never to the
// high-volume general limiter — so the per-request file I/O stays bounded.

function storeFile() {
  const dataDir = process.env.VORLIQ_BACKEND_DATA_DIR || path.join(__dirname, "data");
  return process.env.VORLIQ_RATE_LIMIT_FILE || path.join(dataDir, "rate-limits.json");
}

function readAll() {
  const parsed = safeReadJson(storeFile(), { keys: {} });
  return parsed && typeof parsed.keys === "object" && parsed.keys ? parsed : { keys: {} };
}

function writeAll(store) {
  atomicWriteJson(storeFile(), { keys: store.keys || {} });
}

function prune(store, now) {
  for (const k of Object.keys(store.keys)) {
    if (!store.keys[k] || Number(store.keys[k].resetAt) <= now) delete store.keys[k];
  }
}

class SharedFileStore {
  constructor(namespace) {
    this.namespace = String(namespace || "rl");
    this.windowMs = 60_000;
  }

  // express-rate-limit calls init() with the limiter's options.
  init(options) {
    if (options && Number.isFinite(options.windowMs)) this.windowMs = options.windowMs;
  }

  _key(key) {
    return `${this.namespace}:${key}`;
  }

  async increment(key) {
    const now = Date.now();
    const store = readAll();
    prune(store, now);
    const full = this._key(key);
    let entry = store.keys[full];
    if (!entry || Number(entry.resetAt) <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
    }
    entry.count += 1;
    store.keys[full] = entry;
    writeAll(store);
    return { totalHits: entry.count, resetTime: new Date(entry.resetAt) };
  }

  async decrement(key) {
    const store = readAll();
    const full = this._key(key);
    if (store.keys[full] && store.keys[full].count > 0) {
      store.keys[full].count -= 1;
      writeAll(store);
    }
  }

  async resetKey(key) {
    const store = readAll();
    delete store.keys[this._key(key)];
    writeAll(store);
  }

  async resetAll() {
    writeAll({ keys: {} });
  }
}

// Standalone counter for the admin brute-force lockout (which is not an
// express-rate-limit limiter): records a failure and reports the hit count within
// the window, sharing the same file so the lockout is global across workers.
function recordHit(namespace, key, windowMs, now = Date.now()) {
  const store = readAll();
  prune(store, now);
  const full = `${namespace}:${key}`;
  let entry = store.keys[full];
  if (!entry || Number(entry.resetAt) <= now) entry = { count: 0, resetAt: now + windowMs };
  entry.count += 1;
  store.keys[full] = entry;
  writeAll(store);
  return { count: entry.count, resetAt: entry.resetAt };
}

function peekHit(namespace, key, now = Date.now()) {
  const entry = readAll().keys[`${namespace}:${key}`];
  if (!entry || Number(entry.resetAt) <= now) return { count: 0, resetAt: 0 };
  return { count: entry.count, resetAt: entry.resetAt };
}

function clearHit(namespace, key) {
  const store = readAll();
  delete store.keys[`${namespace}:${key}`];
  writeAll(store);
}

// Test helper: wipe the whole shared store.
function resetStore() {
  writeAll({ keys: {} });
}

module.exports = {
  SharedFileStore,
  storeFile,
  recordHit,
  peekHit,
  clearHit,
  resetStore,
};
