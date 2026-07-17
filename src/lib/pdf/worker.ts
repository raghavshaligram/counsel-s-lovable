// PDF.js worker bootstrap. Client-only — pdfjs touches DOMMatrix at
// module-eval time, which doesn't exist during Cloudflare Worker SSR.
// We dynamic-import to keep it out of the SSR bundle entirely.

type PdfjsModule = typeof import("pdfjs-dist");
let cached: PdfjsModule | null = null;

// Same-origin runtime assets for PDF.js. Callers pass these into getDocument;
// do not monkey-patch the ESM module exports because they are read-only.
export const PDFJS_ASSET_DEFAULTS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
} as const;

function ensureCollectionCompat() {
  type GetOrInsertComputed<K, V> = (key: K, callback: () => V) => V;
  const install = <K extends object | unknown, V>(proto: object) => {
    const target = proto as { getOrInsertComputed?: GetOrInsertComputed<K, V> };
    if (typeof target.getOrInsertComputed === "function") return;
    Object.defineProperty(target, "getOrInsertComputed", {
      configurable: true,
      writable: true,
      value(this: Map<K, V> | WeakMap<K & object, V>, key: K, callback: () => V) {
        if (this.has(key as never)) return this.get(key as never);
        const value = callback();
        this.set(key as never, value as never);
        return value;
      },
    });
  };
  install(Map.prototype);
  if (typeof WeakMap !== "undefined") install(WeakMap.prototype);
}

export async function loadPdfjs(): Promise<PdfjsModule> {
  if (cached) return cached;
  // Allow both window (main thread) and WorkerGlobalScope (web workers).
  // Block only true SSR (no window AND no self/importScripts).
  const hasWindow = typeof window !== "undefined";
  const hasWorker = typeof self !== "undefined" && typeof (self as unknown as { importScripts?: unknown }).importScripts === "function";
  if (!hasWindow && !hasWorker) {
    throw new Error("pdfjs can only be loaded in the browser");
  }
  ensureCollectionCompat();
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
