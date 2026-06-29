/**
 * Test setup — patches `fetch` so modules that load /fonts/* via URL
 * during addBates / sanitize keep working under plain Node.
 *
 * The production code calls `fetch("/fonts/liberation/<file>.ttf")`. In
 * the browser that resolves against `public/`. We translate the same
 * path to a filesystem read here.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_ROOT = path.resolve(__dirname, "..", "public");
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/")) {
    try {
      const buf = await readFile(path.join(PUBLIC_ROOT, url));
      return new Response(buf, { status: 200 });
    } catch (err) {
      return new Response(`not found: ${url} (${(err as Error).message})`, { status: 404 });
    }
  }
  return originalFetch(input as RequestInfo, init);
}) as typeof fetch;
