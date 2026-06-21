/* Vorliq service worker.
 *
 * Caches the app shell so repeat visits load instantly and show a meaningful
 * offline screen instead of a browser error. It deliberately NEVER caches API
 * traffic (anything under /api, incl. socket.io): balances, transactions, and
 * all chain data must always be fresh from the network.
 */
const CACHE = "vorliq-shell-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/offline.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function cachePut(request, response) {
  if (response && response.ok && response.type === "basic") {
    caches.open(CACHE).then((cache) => cache.put(request, response));
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch API or realtime traffic — it must always hit the network so
  // balance and transaction data are never served stale.
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/socket.io")) {
    return;
  }
  // Only handle same-origin requests; let cross-origin pass through untouched.
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the cached app shell instantly when present (revalidating
  // in the background); otherwise go to the network; if both fail, show offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cachedShell = await cache.match("/index.html");
        const networkShell = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put("/index.html", response.clone());
            return response;
          })
          .catch(() => null);
        return cachedShell || (await networkShell) || cache.match("/offline.html");
      })()
    );
    return;
  }

  // Static assets (hashed JS/CSS/images): cache-first, refreshed in the
  // background so a new deploy's hashed files are picked up on the next load.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          cachePut(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
