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
 * Minimal shape of the pdf.js PDFWorker we depend on. Kept opaque so we
 * don't have to import the pdfjs types at every call site.
 */
export type PdfWorkerHandle = {
  destroyed?: boolean;
  destroy?: () => void | Promise<void>;
  terminate?: () => void;
};

/**
 * Spawn a fresh, dedicated pdf.js Web Worker. Each opened document owns
 * its own worker so a stuck document can be terminated in isolation
 * without wedging every other tab (which would happen with the shared
 * GlobalWorkerOptions worker singleton).
 */
export async function createPdfWorker(): Promise<PdfWorkerHandle> {
  const pdfjs = await loadPdfjs();
  const Ctor = (pdfjs as unknown as { PDFWorker: new (opts?: unknown) => PdfWorkerHandle }).PDFWorker;
  return new Ctor({ name: `pdfjs-worker-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}` });
}

/**
 * Best-effort teardown of a per-doc worker. First tries the graceful
 * destroy() (races a 1.5s timeout), then unconditionally terminates the
 * underlying Worker thread so a wedged worker cannot hold resources or
 * queue work for the next open.
 */
export async function destroyPdfWorker(worker: PdfWorkerHandle | null | undefined): Promise<void> {
  if (!worker) return;
  try {
    const p = worker.destroy?.();
    if (p && typeof (p as Promise<unknown>).then === "function") {
      await Promise.race([
        (p as Promise<unknown>).catch(() => undefined),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
  } catch { /* ignore */ }
  try { worker.terminate?.(); } catch { /* ignore */ }
}

/**
 * Drop the cached pdf.js module reference. Kept for back-compat with the
 * previous "reset" recovery path; with per-doc workers we no longer need
 * to swap the module itself, but call sites still import this symbol.
 */
export function resetPdfjs(): void {
  // Intentionally no-op on the module cache: re-importing pdf.js does not
  // spawn a fresh underlying Worker (that's per-doc now). Left as an
  // exported symbol so existing imports keep compiling.
}

/**
 * Awaits a pdf.js task with a watchdog. If it doesn't settle in `ms`,
 * terminates the doc's dedicated worker (when supplied) and rejects.
 * Use around getDocument(...).promise to make heavy-doc hangs recoverable.
 */
export async function withPdfjsWatchdog<T>(
  task: Promise<T>,
  ms = 30_000,
  onTimeout?: () => void,
  worker?: PdfWorkerHandle | null,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Kill the wedged worker so its Worker thread is freed. The next
      // open spawns a new dedicated worker via createPdfWorker().
      if (worker) { void destroyPdfWorker(worker); }
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
