/**
 * Main-thread client for the pixel-verify worker.
 *
 * Fresh worker per call, terminated on completion so the OCR-free bitmap
 * check releases all memory immediately after use.
 */
import { toTransferable } from "./release";
import type { PixelVerifyTarget, PixelLeak } from "./pixel-verify.worker";

export interface PixelVerifyClientResult {
  ok: boolean;
  total: number;
  removed: number;
  leaks: PixelLeak[];
  scannedAt: string;
}

let reqCounter = 0;

function createWorker(): Worker {
  return new Worker(new URL("./pixel-verify.worker.ts", import.meta.url), {
    type: "module",
    name: "counselpdf-pixel-verify",
  });
}

interface OutboundMsg {
  kind: "result" | "error";
  id: string;
  ok?: boolean;
  total?: number;
  removed?: number;
  leaks?: PixelLeak[];
  message?: string;
}

export function verifyPixelRedactionInWorker(
  bytes: Uint8Array,
  targets: PixelVerifyTarget[],
  pagesToCheck: Set<number>,
  opts: { scale?: number; signal?: AbortSignal } = {},
): Promise<PixelVerifyClientResult> {
  return new Promise<PixelVerifyClientResult>((resolve, reject) => {
    const w = createWorker();
    const id = `pixv-${++reqCounter}`;
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
      if (m.kind === "result") {
        finish(() => resolve({
          ok: !!m.ok,
          total: m.total ?? 0,
          removed: m.removed ?? 0,
          leaks: m.leaks ?? [],
          scannedAt: new Date().toISOString(),
        }));
      } else if (m.kind === "error") {
        finish(() => reject(new Error(m.message ?? "pixel-verify failed")));
      }
    };
    const onAbort = () => {
      try { w.postMessage({ kind: "cancel", id }); } catch { /* ignore */ }
      finish(() => reject(new DOMException("Canceled", "AbortError")));
    };
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort);
    w.addEventListener("message", handler);

    const buf = toTransferable(bytes);
    w.postMessage(
      {
        kind: "verify",
        id,
        bytes: buf,
        targets,
        pagesToCheck: Array.from(pagesToCheck),
        scale: opts.scale ?? 2.5,
      },
      [buf],
    );
  });
}
