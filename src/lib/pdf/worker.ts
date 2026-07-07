// PDF.js worker bootstrap. Client-only — pdfjs touches DOMMatrix at
// module-eval time, which doesn't exist during Cloudflare Worker SSR.
// We dynamic-import to keep it out of the SSR bundle entirely.

type PdfjsModule = typeof import("pdfjs-dist");
let cached: PdfjsModule | null = null;

function installPdfjsCompatShims() {
  const mapProto = Map.prototype as Map<unknown, unknown> & {
    getOrInsert?: (key: unknown, value: unknown) => unknown;
    getOrInsertComputed?: (key: unknown, compute: (key: unknown) => unknown) => unknown;
  };

  mapProto.getOrInsert ??= function getOrInsert(this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (!this.has(key)) this.set(key, value);
    return this.get(key);
  };

  mapProto.getOrInsertComputed ??= function getOrInsertComputed(
    this: Map<unknown, unknown>,
    key: unknown,
    compute: (key: unknown) => unknown,
  ) {
    if (!this.has(key)) this.set(key, compute(key));
    return this.get(key);
  };

  const promiseCtor = Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };

  promiseCtor.withResolvers ??= function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export async function loadPdfjs(): Promise<PdfjsModule> {
  if (cached) return cached;
  // Allow both window (main thread) and WorkerGlobalScope (web workers).
  // Block only true SSR (no browser global). Module workers do not reliably
  // expose `importScripts`, so checking for it incorrectly rejects the
  // redaction rasterize/pixel-verify workers.
  const hasWindow = typeof window !== "undefined";
  const hasWorker = typeof self !== "undefined" && typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
  if (!hasWindow && !hasWorker) {
    throw new Error("pdfjs can only be loaded in the browser");
  }
  installPdfjsCompatShims();
  const pdfjs = await import("pdfjs-dist");
  if (hasWorker) {
    // Redaction already runs inside our own dedicated workers. Letting pdf.js
    // spawn another nested worker bypasses these shims in that nested global
    // and crashes on browsers without `Map#getOrInsertComputed`. Fake-worker
    // mode stays inside this redaction worker, so the shimmed APIs are present.
    const [workerUrlMod, workerModule] = await Promise.all([
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      import("pdfjs-dist/build/pdf.worker.min.mjs"),
    ]);
    (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = workerModule;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrlMod.default;
  } else {
    const workerUrlMod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrlMod.default;
  }
  cached = pdfjs;
  return pdfjs;
}

// Back-compat shim: previous code called getPdfjs() synchronously.
// Keeping the name but it now returns a promise.
export const getPdfjs = loadPdfjs;
