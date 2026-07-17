/**
 * Main-thread client for the rasterize worker.
 *
 * Spawns a fresh dedicated worker per call and terminates it as soon as
 * the result is received (or on error/abort). That termination is the
 * memory-release step — the whole worker heap goes away in one shot.
 */
import { toTransferable } from "./release";

export interface RectTL { x: number; y: number; w: number; h: number }

export interface RasterizeWorkerOptions {
  mode?: "always" | "fallback";
  scale?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Transfer the caller's ArrayBuffer to the worker (zero-copy). After the
   *  call, the caller's Uint8Array is empty. Only use when the caller drops
   *  its reference to sourceBytes immediately. */
  stealBytes?: boolean;
}

export interface RasterizeWorkerResult {
  bytes: Uint8Array;
  rasterizedPages: number[];
}

let reqCounter = 0;

function createWorker(): Worker {
  return new Worker(new URL("./rasterize.worker.ts", import.meta.url), {
    type: "module",
    name: "pdfmacro-rasterize",
  });
}

interface OutboundMsg {
  kind: "progress" | "result" | "error";
  id: string;
  done?: number;
  total?: number;
  bytes?: ArrayBuffer;
  rasterizedPages?: number[];
  message?: string;
}

export function rasterizeRedactedPagesInWorker(
  sourceBytes: Uint8Array,
  pageRedactions: Map<number, RectTL[]>,
  opts: RasterizeWorkerOptions = {},
): Promise<RasterizeWorkerResult> {
  return new Promise<RasterizeWorkerResult>((resolve, reject) => {
    const w = createWorker();
    const id = `raster-${++reqCounter}`;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      w.removeEventListener("message", handler);
      opts.signal?.removeEventListener("abort", onAbort);
      w.terminate();
      fn();
    };
    const handler = (ev: MessageEvent<OutboundMsg>) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.kind === "progress" && typeof m.done === "number" && typeof m.total === "number") {
        try { opts.onProgress?.(m.done, m.total); } catch { /* ignore */ }
      } else if (m.kind === "result" && m.bytes && m.rasterizedPages) {
        finish(() => resolve({ bytes: new Uint8Array(m.bytes!), rasterizedPages: m.rasterizedPages! }));
      } else if (m.kind === "error") {
        finish(() => reject(new Error(m.message ?? "rasterize failed")));
      }
    };
    const onAbort = () => {
      try { w.postMessage({ kind: "cancel", id }); } catch { /* ignore */ }
      finish(() => reject(new DOMException("Canceled", "AbortError")));
    };
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort);
    w.addEventListener("message", handler);

    const buf = toTransferable(sourceBytes, { steal: opts.stealBytes });
    w.postMessage(
      {
        kind: "rasterize",
        id,
        bytes: buf,
        pageRedactions: Array.from(pageRedactions.entries()),
        mode: opts.mode ?? "always",
        scale: opts.scale ?? 2.5,
      },
      [buf],
    );
  });
}
