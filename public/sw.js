/*
 * Solaris service worker (hand-written, no dependencies).
 *  - Precaches the app shell so the simulators open offline.
 *  - Static assets and map tiles: cache-first (tiles are size-capped).
 *  - Navigations: network-first, falling back to cache, then /offline.html.
 *  - NEVER caches /api/* (it carries SOS data) and never touches non-GET requests.
 */
const VERSION = "v1";
const SHELL_CACHE = `solaris-shell-${VERSION}`;
const STATIC_CACHE = `solaris-static-${VERSION}`;
const TILE_CACHE = `solaris-tiles-${VERSION}`;
const KNOWN = [SHELL_CACHE, STATIC_CACHE, TILE_CACHE];
const MAX_TILES = 300;

const SHELL = ["/", "/citizen", "/command-center", "/mesh", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Each page is added on its own so one failure does not abort the whole install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("solaris-") && !KNOWN.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === "opaque") {
    cache.put(request, res.clone()).then(() => (max ? trimCache(cacheName, max) : undefined));
  }
  return res;
}

async function networkFirstNavigation(request) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(SHELL_CACHE)).put(request, res.clone());
    return res;
  } catch {
    const cached = await caches.match(request);
    return cached || (await caches.match("/offline.html")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never cache POSTs (SOS packets, actions)
  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return; // SOS data: network only

  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(cacheFirst(request, TILE_CACHE, MAX_TILES).catch(() => Response.error()));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE).catch(() => Response.error()));
  }
});
