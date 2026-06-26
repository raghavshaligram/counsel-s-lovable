/**
 * Lazy loader for qpdf-wasm (Apache-2.0).
 *
 * The Emscripten glue + .wasm are vendored under /public/wasm/qpdf/ and
 * loaded by URL on first use. Nothing is bundled at app startup — this
 * module is dynamic-imported only when Repair needs the strong fallback.
 *
 * The published `qpdf.js` is an IIFE that assigns a `Module` factory to a
 * closure-local variable and then returns it. We inject it as a <script>
 * element and recover the factory from the script's evaluation context.
 *
 * Privacy: WASM runs entirely in-page. Nothing is uploaded.
 */

/** Loose shape of the Emscripten module surface we use. */
export type QpdfModule = {
  FS: {
    mkdir: (path: string) => void;
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    readdir: (path: string) => string[];
    unlink: (path: string) => void;
  };
  callMain: (args: string[]) => number;
  // print / printErr are hooked at construction time.
};

type QpdfFactory = (opts: {
  locateFile?: (path: string) => string;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  noInitialRun?: boolean;
  noExitRuntime?: boolean;
}) => Promise<QpdfModule>;

declare global {
  // The IIFE in qpdf.js assigns `var Module = (() => ...)()` at top level.
  // When loaded via <script>, that top-level `var` lands on `window`.
  // eslint-disable-next-line no-var
  var Module: QpdfFactory | undefined;
  // eslint-disable-next-line no-var
  var __vaultpdfQpdfFactory: QpdfFactory | undefined;
}

const QPDF_BASE = "/wasm/qpdf";

let scriptPromise: Promise<QpdfFactory> | null = null;

function loadFactory(): Promise<QpdfFactory> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<QpdfFactory>((resolve, reject) => {
    // Stash whatever `Module` is on window so we can restore it after.
    const prior = globalThis.Module;
    const s = document.createElement("script");
    s.src = `${QPDF_BASE}/qpdf.js`;
    s.async = true;
    s.onload = () => {
      const factory = globalThis.Module as QpdfFactory | undefined;
      if (typeof factory !== "function") {
        reject(new Error("qpdf-wasm glue did not expose a Module factory"));
        return;
      }
      // Cache it under a private name and restore window.Module.
      globalThis.__vaultpdfQpdfFactory = factory;
      globalThis.Module = prior;
      resolve(factory);
    };
    s.onerror = () => reject(new Error("Failed to fetch /wasm/qpdf/qpdf.js"));
    document.head.appendChild(s);
  }).catch((err) => {
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

/**
 * Instantiate a fresh qpdf module. Each call returns its own MEMFS, so
 * repeated repairs can't leak files into each other.
 */
export async function createQpdfModule(opts?: {
  onStdout?: (s: string) => void;
  onStderr?: (s: string) => void;
}): Promise<QpdfModule> {
  if (typeof window === "undefined") {
    throw new Error("qpdf-wasm is browser-only");
  }
  const factory = await loadFactory();
  return factory({
    locateFile: (p: string) =>
      p.endsWith(".wasm") ? `${QPDF_BASE}/qpdf.wasm` : `${QPDF_BASE}/${p}`,
    noInitialRun: true,
    noExitRuntime: true,
    print: (s) => {
      opts?.onStdout?.(s);
      // eslint-disable-next-line no-console
      console.info("[qpdf:out]", s);
    },
    printErr: (s) => {
      opts?.onStderr?.(s);
      // eslint-disable-next-line no-console
      console.info("[qpdf:err]", s);
    },
  });
}
