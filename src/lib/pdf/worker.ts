// PDF.js worker bootstrap. Client-only — pdfjs touches DOMMatrix at
// module-eval time, which doesn't exist during Cloudflare Worker SSR.
// We dynamic-import to keep it out of the SSR bundle entirely.

// pdf.js 5.x calls `Map.prototype.getOrInsertComputed` (the TC39 "upsert"
// proposal), which is only unflagged natively in Chromium 142+ / recent
// Firefox & Safari. On older-but-still-supported browsers pdf.js crashes the
// moment its MessageHandler upserts a method promise — and because the
// rasterize/render worker has its OWN global scope, a main-thread-only
// polyfill never reaches it. Installing the guarded shim at module scope
// here means every scope that imports this bootstrap (main thread OR web
// worker) gets it before pdf.js loads. No-op where the method is native.
if (
  typeof Map !== "undefined" &&
  !(Map.prototype as unknown as { getOrInsertComputed?: unknown }).getOrInsertComputed
) {
  (Map.prototype as unknown as {
    getOrInsertComputed: (key: unknown, compute: (key: unknown) => unknown) => unknown;
  }).getOrInsertComputed = function (key: unknown, compute: (key: unknown) => unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = this as any;
    if (map.has(key)) return map.get(key);
    const value = compute(key);
    map.set(key, value);
    return value;
  };
}

type PdfjsModule = typeof import("pdfjs-dist");
let cached: PdfjsModule | null = null;

export async function loadPdfjs(): Promise<PdfjsModule> {
  if (cached) return cached;
  // Allow both window (main thread) and WorkerGlobalScope (web workers).
  // Block only true SSR (no window AND no self/importScripts).
  const hasWindow = typeof window !== "undefined";
  const hasWorker = typeof self !== "undefined" && typeof (self as unknown as { importScripts?: unknown }).importScripts === "function";
  if (!hasWindow && !hasWorker) {
    throw new Error("pdfjs can only be loaded in the browser");
  }
  const [pdfjs, workerUrlMod] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrlMod.default;
  cached = pdfjs;
  return pdfjs;
}

// Back-compat shim: previous code called getPdfjs() synchronously.
// Keeping the name but it now returns a promise.
export const getPdfjs = loadPdfjs;
