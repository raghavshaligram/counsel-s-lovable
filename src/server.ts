import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Routes whose SSR HTML is identical for every visitor (no server loader,
// no per-user data). Safe to cache at the edge.
// Everything NOT in this set falls through to no-cache (auth, workspace,
// account/billing/certificates/sessions, hq, chat, reset-password, api,
// sitemap, etc.).
const CACHEABLE_HTML_PATHS = new Set<string>([
  "/",
  "/pricing",
  "/security-architecture",
  "/verify-privacy",
  "/verifiable-redaction",
  "/privilege-and-ai",
  // Tool pages — public marketing/landing shells
  "/editor",
  "/redact",
  "/merge",
  "/split",
  "/compress",
  "/crop",
  "/rotate",
  "/extract",
  "/flatten",
  "/header-footer",
  "/page-numbers",
  "/watermark",
  "/ocr",
  "/organize",
  "/outline",
  "/bates",
  "/privilege-scan",
  "/compare",
  "/protect",
  "/unlock",
  "/sign",
  "/to-word",
  "/to-excel",
  "/word-to-pdf",
]);

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function applyEdgeCacheHeaders(request: Request, response: Response): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  if (response.status < 200 || response.status >= 300) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  let pathname: string;
  try {
    pathname = normalizePath(new URL(request.url).pathname);
  } catch {
    return response;
  }
  if (!CACHEABLE_HTML_PATHS.has(pathname)) return response;

  // Don't cache HTML that carries an auth/query token
  const search = new URL(request.url).search;
  if (/[?&](code|token|access_token|refresh_token|type|error|error_description)=/i.test(search)) {
    return response;
  }

  const headers = new Headers(response.headers);
  // 5 min fresh at the edge, serve stale for 24h while revalidating.
  headers.set(
    "cache-control",
    "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
  );
  // Vary on cookie so signed-in variants (if ever added) don't get served
  // to signed-out visitors from the cache.
  const existingVary = headers.get("vary");
  headers.set("vary", existingVary ? `${existingVary}, Cookie` : "Cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Worker-side cache using the Cloudflare Cache API. We can't rely on the
// downstream `cache-control` header (the platform rewrites it to no-cache
// on the response we return to the browser), so we store rendered HTML in
// caches.default keyed by URL and short-circuit future requests here.
const WORKER_CACHE_TTL_SECONDS = 300; // 5 min fresh
const WORKER_CACHE_SWR_SECONDS = 86_400; // serve stale up to 24h

let workerCacheDisabled = false;
function getWorkerCache(): Cache | undefined {
  if (workerCacheDisabled) return undefined;
  try {
    const c = (globalThis as unknown as { caches?: CacheStorage }).caches;
    return c && "default" in c ? (c as unknown as { default: Cache }).default : undefined;
  } catch {
    workerCacheDisabled = true;
    return undefined;
  }
}

function isCacheableRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  let url: URL;
  try { url = new URL(request.url); } catch { return false; }
  if (!CACHEABLE_HTML_PATHS.has(normalizePath(url.pathname))) return false;
  if (/[?&](code|token|access_token|refresh_token|type|error|error_description)=/i.test(url.search)) return false;
  // Skip if the visitor has an app session cookie (signed in).
  const cookie = request.headers.get("cookie") ?? "";
  if (/(^|;\s*)sb-[^=]+-auth-token=/.test(cookie)) return false;
  return true;
}

function buildCacheKey(request: Request): Request {
  const url = new URL(request.url);
  // Strip search entirely for cache key — all cacheable paths render the
  // same shell regardless of query string (client-only routing after that).
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

async function tryCachedResponse(request: Request): Promise<Response | undefined> {
  const cache = getWorkerCache();
  if (!cache) return undefined;
  const hit = await cache.match(buildCacheKey(request));
  if (!hit) return undefined;
  const storedAt = Number(hit.headers.get("x-worker-cached-at") ?? "0");
  const ageSec = storedAt ? (Date.now() - storedAt) / 1000 : Number.POSITIVE_INFINITY;
  if (ageSec > WORKER_CACHE_TTL_SECONDS + WORKER_CACHE_SWR_SECONDS) return undefined;
  const headers = new Headers(hit.headers);
  headers.set("x-worker-cache", ageSec <= WORKER_CACHE_TTL_SECONDS ? "HIT" : "STALE");
  headers.set("age", String(Math.max(0, Math.floor(ageSec))));
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}

async function storeInWorkerCache(
  request: Request,
  response: Response,
  ctx: unknown,
): Promise<void> {
  const cache = getWorkerCache();
  if (!cache) return;
  if (response.status !== 200) return;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return;
  const buf = await response.clone().arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set("x-worker-cached-at", String(Date.now()));
  // Strip Set-Cookie from cached copy — never replay another visitor's cookie.
  headers.delete("set-cookie");
  const cached = new Response(buf, { status: 200, headers });
  const put = cache.put(buildCacheKey(request), cached);
  const c = ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
  if (c?.waitUntil) c.waitUntil(put); else await put;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (isCacheableRequest(request)) {
        const cached = await tryCachedResponse(request);
        if (cached) return cached;
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      const withHeaders = applyEdgeCacheHeaders(request, normalized);
      if (isCacheableRequest(request)) {
        await storeInWorkerCache(request, withHeaders, ctx);
      }
      return withHeaders;
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};


