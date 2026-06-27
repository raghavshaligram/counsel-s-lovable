// VaultPDF Service Worker — true offline operation.
//
// Strategy:
//  - Precache the minimal app shell on install.
//  - Runtime CacheFirst for same-origin static assets (JS/CSS/WASM/fonts/images),
//    including /wasm/qpdf/* and Vite-hashed chunks. Once fetched, they live in
//    cache forever (hashed filenames make this safe).
//  - Runtime CacheFirst for known third-party assets needed by features that
//    must work offline: tesseract.js core/worker (unpkg, jsdelivr) and the
//    tessdata language packs (tessdata.projectnaptha.com / raw.githubusercontent).
//  - Runtime CacheFirst for Google Fonts CSS + font binaries.
//  - NetworkFirst for HTML navigations so a redeploy reaches the user, with
//    an offline fallback to the cached shell.
//
// All processing remains on-device — the SW just makes the bytes available
// when the network is gone.

const VERSION = "vaultpdf-v3-offline";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const THIRDPARTY_CACHE = `${VERSION}-thirdparty`;
const NAV_CACHE = `${VERSION}-nav`;

const SHELL_URLS = ["/", "/manifest.webmanifest"];

const THIRD_PARTY_HOSTS = new Set([
  "unpkg.com",
  "cdn.jsdelivr.net",
  "tessdata.projectnaptha.com",
  "raw.githubusercontent.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_URLS))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isHashedAssetPath(pathname) {
  // Vite emits /assets/<name>-<hash>.<ext> — hashed and immutable.
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/wasm/")) return true;
  if (pathname.startsWith("/_build/")) return true;
  return /\.(js|mjs|css|wasm|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|webp|avif|ico|json)$/i.test(
    pathname,
  );
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    // Only cache successful basic/cors responses.
    if (res && (res.status === 200 || res.type === "opaque")) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function networkFirstNav(req) {
  const cache = await caches.open(NAV_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    const shell = await caches.open(SHELL_CACHE);
    const fallback = await shell.match("/");
    if (fallback) return fallback;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // HTML navigations — NetworkFirst with offline shell fallback.
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNav(req));
    return;
  }

  if (url.origin === self.location.origin) {
    if (isHashedAssetPath(url.pathname)) {
      event.respondWith(cacheFirst(req, ASSET_CACHE));
      return;
    }
    // Other same-origin GETs: try cache, then network, then cache the result.
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }

  // Cross-origin — only handle known third-party hosts our features need offline.
  if (THIRD_PARTY_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(req, THIRDPARTY_CACHE));
    return;
  }

  // Anything else: let the browser do its thing (no caching).
});
