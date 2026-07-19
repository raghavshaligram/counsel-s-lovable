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

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return applyEdgeCacheHeaders(request, normalized);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

