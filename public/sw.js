// CounselPDF Service Worker — true offline operation.
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

const VERSION = "counselpdf-v5-offline";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const THIRDPARTY_CACHE = `${VERSION}-thirdparty`;
const NAV_CACHE = `${VERSION}-nav`;

const OFFLINE_URL = "/offline.html";
const SHELL_URLS = ["/", "/manifest.webmanifest", OFFLINE_URL];

// Local assets that on-device pipelines fetch at runtime (fonts for
// certificate/PDF-A embed, qpdf WASM for unlock/repair). Pre-caching
// them guarantees Sanitize / Redact / Export / Bates / Compress all
// work even if the user goes offline before ever exercising the tool.
const PRECACHE_ASSETS = [
  "/fonts/liberation/LiberationSans-Regular.ttf",
  "/fonts/liberation/LiberationSans-Bold.ttf",
  "/fonts/liberation/LiberationSans-Italic.ttf",
  "/fonts/liberation/LiberationSans-BoldItalic.ttf",
  "/fonts/liberation/LiberationSerif-Regular.ttf",
  "/fonts/liberation/LiberationSerif-Bold.ttf",
  "/fonts/liberation/LiberationSerif-Italic.ttf",
  "/fonts/liberation/LiberationSerif-BoldItalic.ttf",
  "/fonts/liberation/LiberationMono-Regular.ttf",
  "/fonts/liberation/LiberationMono-Bold.ttf",
  "/fonts/liberation/LiberationMono-Italic.ttf",
  "/fonts/liberation/LiberationMono-BoldItalic.ttf",
  "/wasm/qpdf/qpdf.js",
  "/wasm/qpdf/qpdf.wasm",
  "/wasm/qpdf/browser.js",
];


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
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(SHELL_URLS).catch(() => {});
      const assets = await caches.open(ASSET_CACHE);
      // Best-effort: don't fail install if a font/wasm 404s in dev.
      await Promise.all(
        PRECACHE_ASSETS.map((u) =>
          assets.add(u).catch(() => {}),
        ),
      );
    })(),
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
    // Prefer the branded offline page so users never see the browser's
    // default "no internet" error. Fall back to the cached app shell.
    const offline = await shell.match(OFFLINE_URL);
    if (offline) return offline;
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
