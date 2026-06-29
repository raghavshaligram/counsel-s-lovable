/**
 * Automation Runner — main-thread API. Spawns a dedicated Web Worker,
 * pipes bytes through the pipeline, surfaces progress, returns final bytes.
 *
 * Usage:
 *   const { bytes, steps } = await runPipeline(input, pipeline, (ev) => {...});
 *
 * Privacy: nothing leaves the browser. The worker is module-scoped and
 * imports the same on-device pdf-lib ops the rest of the app uses.
 */

import type { Pipeline, ProgressEvent, RunResult } from "./types";

let cachedWorker: Worker | null = null;
function getWorker(): Worker {
  if (cachedWorker) return cachedWorker;
  cachedWorker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "counselpdf-automation",
  });
  return cachedWorker;
}

export interface RunPipelineOptions {
  onProgress?: (ev: ProgressEvent) => void;
  signal?: AbortSignal;
}

let runCounter = 0;

export function runPipeline(
  bytes: Uint8Array,
  pipeline: Pipeline,
  opts: RunPipelineOptions = {},
): Promise<RunResult> {
  const id = `run-${++runCounter}-${Date.now()}`;
  const worker = getWorker();

  return new Promise<RunResult>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.id !== id) return;
      if (m.kind === "progress") {
        opts.onProgress?.(m.event as ProgressEvent);
        return;
      }
      if (m.kind === "result") {
        cleanup();
        resolve({
          bytes: new Uint8Array(m.bytes as ArrayBuffer),
          steps: m.steps,
          totalElapsedMs: m.totalElapsedMs,
        });
        return;
      }
      if (m.kind === "error") {
        cleanup();
        const err = new Error(
          `Step ${m.index} (${m.op}) failed: ${m.message}`,
        ) as Error & { stepIndex?: number; op?: string };
        err.stepIndex = m.index;
        err.op = m.op;
        reject(err);
        return;
      }
    };
    const onErr = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(`Worker error: ${e.message}`));
    };
    const onAbort = () => {
      cleanup();
      // Terminate so the worker stops mid-pipeline.
      try { worker.terminate(); } catch { /* noop */ }
      cachedWorker = null;
      reject(new DOMException("Aborted", "AbortError"));
    };

    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    // Transfer the buffer to the worker (zero-copy).
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    worker.postMessage({ kind: "run", id, pipeline, bytes: buf }, [buf]);
  });
}

/** Convenience: download the result as a file. */
export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
