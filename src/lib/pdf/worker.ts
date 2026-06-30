// PDF.js worker bootstrap. Client-only — pdfjs touches DOMMatrix at
// module-eval time, which doesn't exist during Cloudflare Worker SSR.
// We dynamic-import to keep it out of the SSR bundle entirely.

type PdfjsModule = typeof import("pdfjs-dist");
let cached: PdfjsModule | null = null;

export async function loadPdfjs(): Promise<PdfjsModule> {
  if (cached) return cached;
  if (typeof window === "undefined") {
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

/**
 * Drop the cached pdf.js module so the next loadPdfjs() spawns a fresh
 * underlying Web Worker. Use this when the pdfjs worker appears wedged
 * (e.g. getDocument() hangs past a watchdog) — recovers without forcing
 * the user to refresh the whole browser tab.
 */
export function resetPdfjs(): void {
  cached = null;
}

/**
 * Awaits a pdf.js task with a watchdog. If it doesn't settle in `ms`,
 * resets the pdfjs cache (next call re-spawns the worker) and rejects.
 * Use around getDocument(...).promise to make heavy-doc hangs recoverable.
 */
export async function withPdfjsWatchdog<T>(
  task: Promise<T>,
  ms = 30_000,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      resetPdfjs();
      onTimeout?.();
      reject(new Error("pdfjs-watchdog-timeout"));
    }, ms);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
