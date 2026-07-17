/**
 * Main-thread client for the Bates worker. Keeps the pdf-lib parse + save
 * off the UI thread so 5000-page "Apply to active tab" stays responsive
 * and cancelable.
 */
import type { BatesOpts } from "@/lib/batch/ops/bates";

export interface BatesProgress {
  done: number;
  total: number;
}

export interface BatesWorkerResult {
  bytes: Uint8Array;
  pageCount: number;
}

let reqCounter = 0;

function createWorker(): Worker {
  return new Worker(new URL("./bates.worker.ts", import.meta.url), {
    type: "module",
    name: "pdfmacro-bates",
  });
}

interface OutboundMsg {
  kind: "progress" | "result" | "error";
  id: string;
  done?: number;
  total?: number;
  bytes?: ArrayBuffer;
  pageCount?: number;
  message?: string;
}

export function stampBatesInWorker(
  sourceBytes: Uint8Array,
  opts: BatesOpts,
  runOpts: {
    onProgress?: (p: BatesProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<BatesWorkerResult> {
  return new Promise<BatesWorkerResult>((resolve, reject) => {
    const w = createWorker();
    const id = `bates-${++reqCounter}`;
    let settled = false;

    const handler = (ev: MessageEvent<OutboundMsg>) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.kind === "progress" && typeof m.done === "number" && typeof m.total === "number") {
        try { runOpts.onProgress?.({ done: m.done, total: m.total }); } catch { /* ignore */ }
      } else if (m.kind === "result" && m.bytes && typeof m.pageCount === "number") {
        if (settled) return;
        settled = true;
        w.removeEventListener("message", handler);
        runOpts.signal?.removeEventListener("abort", onAbort);
        w.terminate();
        resolve({ bytes: new Uint8Array(m.bytes), pageCount: m.pageCount });
      } else if (m.kind === "error") {
        if (settled) return;
        settled = true;
        w.removeEventListener("message", handler);
        runOpts.signal?.removeEventListener("abort", onAbort);
        w.terminate();
        reject(new Error(m.message ?? "bates failed"));
      }
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      try { w.postMessage({ kind: "cancel", id }); } catch { /* ignore */ }
      w.removeEventListener("message", handler);
      w.terminate();
      reject(new DOMException("Canceled", "AbortError"));
    };
    if (runOpts.signal?.aborted) return onAbort();
    runOpts.signal?.addEventListener("abort", onAbort);
    w.addEventListener("message", handler);

    // Copy bytes into a transferable so we neuter only the copy — the
    // caller's source buffer (typically the editor's live srcBytes)
    // stays intact until we swap it.
    const copy = new Uint8Array(sourceBytes.byteLength);
    copy.set(sourceBytes);
    const buf = copy.buffer;
    w.postMessage({ kind: "stamp", id, bytes: buf, opts }, [buf]);
  });
}
