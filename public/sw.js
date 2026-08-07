/*
 * App-shell service worker.
 *
 * Deliberately narrow: it precaches the built shell and serves it offline, and it refuses
 * to touch anything else. Market data must never be cached — a liquidation map rebuilt
 * from yesterday's candles is worse than no map at all, because it looks current.
 */
/*
 * Bump this when the shell precache must be rebuilt. `activate` deletes every cache whose
 * name is not the current one, so a bump is also the eviction.
 */
const CACHE = 'liqmap-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // `reload` bypasses the HTTP cache for the precache itself. Without it a fresh worker
      // can install an index.html the browser had already cached, which is the shape of bug
      // that leaves users on an old bundle with no way to pull the new one.
      cache.addAll(
        ['./', './index.html', './manifest.webmanifest'].map(
          (u) => new Request(u, { cache: 'reload' }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything that is not our own origin — Bybit REST above all — goes straight to the
  // network and is never written to the cache.
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the shell so a cold offline launch still opens.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Static assets: cache-first, since Vite fingerprints their filenames.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
