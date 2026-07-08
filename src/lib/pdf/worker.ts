// PDF.js worker bootstrap. Client-only — pdfjs touches DOMMatrix at
// module-eval time, which doesn't exist during Cloudflare Worker SSR.
// We dynamic-import to keep it out of the SSR bundle entirely.

type PdfjsModule = typeof import("pdfjs-dist");
let cached: PdfjsModule | null = null;

function ensurePdfjsMapUpsertPolyfills(): void {
  const mapProto = Map.prototype as unknown as {
    getOrInsertComputed?: (key: unknown, cb: (key: unknown) => unknown) => unknown;
  };
  const weakMapProto = WeakMap.prototype as unknown as {
    getOrInsertComputed?: (key: object, cb: (key: object) => unknown) => unknown;
  };
  if (typeof Map !== "undefined" && !mapProto.getOrInsertComputed) {
    mapProto.getOrInsertComputed = function (key: unknown, cb: (key: unknown) => unknown) {
      const selfMap = this as unknown as Map<unknown, unknown>;
      if (selfMap.has(key)) return selfMap.get(key);
      const value = cb(key);
      selfMap.set(key, value);
      return value;
    };
  }
  if (typeof WeakMap !== "undefined" && !weakMapProto.getOrInsertComputed) {
    weakMapProto.getOrInsertComputed = function (key: object, cb: (key: object) => unknown) {
      const selfMap = this as unknown as WeakMap<object, unknown>;
      if (selfMap.has(key)) return selfMap.get(key);
      const value = cb(key);
      selfMap.set(key, value);
      return value;
    };
  }
}

ensurePdfjsMapUpsertPolyfills();

export async function loadPdfjs(): Promise<PdfjsModule> {
  if (cached) return cached;
  // pdf.js 5.x uses the TC39 Map upsert proposal in worker code paths. Some
  // Chromium builds used by users/tests do not expose it yet, so polyfill in
  // both window and dedicated-worker scopes before importing pdf.js.
  ensurePdfjsMapUpsertPolyfills();
  // Allow both window (main thread) and WorkerGlobalScope (web workers).
  // Block only true SSR (no window AND no self/importScripts).
  const hasWindow = typeof window !== "undefined";
  const hasWorker = typeof self !== "undefined" && typeof (self as unknown as { importScripts?: unknown }).importScripts === "function";
  if (!hasWindow && !hasWorker) {
    throw new Error("pdfjs can only be loaded in the browser");
  }
  const [pdfjs, workerUrlMod] = await Promise.all([
    import("pdfjs-dist"),
    import("./pdfjs-worker-polyfill?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrlMod.default;
  cached = pdfjs;
  return pdfjs;
}

// Back-compat shim: previous code called getPdfjs() synchronously.
// Keeping the name but it now returns a promise.
export const getPdfjs = loadPdfjs;
