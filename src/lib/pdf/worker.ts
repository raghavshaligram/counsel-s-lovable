// PDF.js worker bootstrap. Client-only — pdfjs touches DOMMatrix at
// module-eval time, which doesn't exist during Cloudflare Worker SSR.
// We dynamic-import to keep it out of the SSR bundle entirely.

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

  // Inject default URLs for cmaps / standard fonts / wasm image decoders so
  // every `getDocument` call finds them on the same origin. Without these,
  // PDFs that use CJK cmaps, missing standard-14 fonts, or JPEG2000 / JBIG2
  // images fail with an "Unable to load …" error that the workspace
  // surfaces as "This file appears to be corrupted or unreadable." Serving
  // them locally also keeps everything working in Offline — Isolated mode.
  const ASSET_DEFAULTS = {
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  } as const;
  const origGetDocument = pdfjs.getDocument.bind(pdfjs);
  (pdfjs as unknown as { getDocument: typeof pdfjs.getDocument }).getDocument = ((
    src: unknown,
  ) => {
    if (
      src && typeof src === "object" &&
      !(src instanceof Uint8Array) && !(src instanceof ArrayBuffer)
    ) {
      const merged = {
        ...(ASSET_DEFAULTS as Record<string, unknown>),
        ...(src as Record<string, unknown>),
      };
      return origGetDocument(merged as never);
    }
    return origGetDocument({ data: src as never, ...ASSET_DEFAULTS } as never);
  }) as typeof pdfjs.getDocument;

  cached = pdfjs;
  return pdfjs;
}

// Back-compat shim: previous code called getPdfjs() synchronously.
// Keeping the name but it now returns a promise.
export const getPdfjs = loadPdfjs;
