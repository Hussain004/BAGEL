/*
 * BAGEL service worker: makes the app load with no network after a first visit.
 *
 * Strategy, kept deliberately small:
 *   - Navigations: network first, falling back to the cached app shell, so a
 *     new deploy is picked up when online and the app still opens offline.
 *   - /assets/* (content-hashed by Vite): cache first. A hash never changes
 *     meaning, so a cached copy is always correct.
 *   - Everything else same-origin (icons, sql-wasm.wasm, sample bags):
 *     stale-while-revalidate.
 *   - On a "precache" message, fetch every file listed in /sw-assets.json so
 *     panels never opened online still work offline. The page sends it when
 *     the app is installed; ordinary visitors only cache what they use.
 *
 * Cache lookups pass ignoreVary: the dev/preview server and some CDNs answer
 * with `Vary: Origin`, and a module script requested in CORS mode would then
 * miss the copy fetched during precache, failing offline.
 *
 * Whole Response objects are stored, so the COOP/COEP/CORP headers from the
 * host survive a cache hit. Dropping them would turn crossOriginIsolated off
 * when offline.
 */
const CACHE = 'bagel-app-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function put(cache, request, response) {
  // Only cache complete, successful, same-origin answers. A 206 partial or an
  // opaque cross-origin response would poison the cache.
  if (response.ok && response.status === 200 && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // A Range request (large bag streaming) must reach the network untouched.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          return await put(cache, '/', await fetch(request));
        } catch {
          const shell = await cache.match('/', { ignoreVary: true });
          return shell ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(request, { ignoreVary: true })) ?? put(cache, request, await fetch(request));
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreVary: true });
      const refresh = fetch(request).then((r) => put(cache, request, r));
      if (cached) {
        refresh.catch(() => undefined);
        return cached;
      }
      return refresh;
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache') return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch('/sw-assets.json', { cache: 'no-store' });
      if (!res.ok) return;
      const files = await res.json();
      const wanted = new Set(files);
      for (const f of files) if (!(await cache.match(f))) await put(cache, f, await fetch(f));
      // Drop hashed files from earlier deploys so the cache does not grow forever.
      for (const req of await cache.keys()) {
        const path = new URL(req.url).pathname;
        if (path.startsWith('/assets/') && !wanted.has(path)) await cache.delete(req);
      }
    })(),
  );
});
