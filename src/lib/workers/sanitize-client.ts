/**
 * Main-thread client for the sanitize worker. Mirrors sanitizePdfBytesWithReport
 * but keeps the pdf-lib parse + save off the main thread so 5000-page
 * documents don't lock the UI or OOM the tab.
 */
import type { SanitizeReport } from "@/lib/pdf/sanitize";

export interface SanitizeProgress {
  stage: string;
  done: number;
  total: number;
}

export interface SanitizeResult {
  bytes: Uint8Array;
  report: SanitizeReport;
  pageCount: number;
}

let reqCounter = 0;

function createWorker(): Worker {
  return new Worker(new URL("./sanitize.worker.ts", import.meta.url), {
    type: "module",
    name: "counselpdf-sanitize",
  });
}

interface OutboundMsg {
  kind: "progress" | "result" | "error";
  id: string;
  stage?: string;
  done?: number;
  total?: number;
  bytes?: ArrayBuffer;
  report?: SanitizeReport;
  pageCount?: number;
  message?: string;
}

export function sanitizeInWorker(
  sourceBytes: Uint8Array,
  opts: {
    onProgress?: (p: SanitizeProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<SanitizeResult> {
  return new Promise<SanitizeResult>((resolve, reject) => {
    const w = createWorker();
    const id = `sanitize-${++reqCounter}`;
    let settled = false;

    const handler = (ev: MessageEvent<OutboundMsg>) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.kind === "progress" && typeof m.done === "number" && typeof m.total === "number" && m.stage) {
        try { opts.onProgress?.({ stage: m.stage, done: m.done, total: m.total }); } catch { /* ignore */ }
      } else if (m.kind === "result" && m.bytes && m.report && typeof m.pageCount === "number") {
        if (settled) return;
        settled = true;
        w.removeEventListener("message", handler);
        opts.signal?.removeEventListener("abort", onAbort);
        w.terminate();
        resolve({ bytes: new Uint8Array(m.bytes), report: m.report, pageCount: m.pageCount });
      } else if (m.kind === "error") {
        if (settled) return;
        settled = true;
        w.removeEventListener("message", handler);
        opts.signal?.removeEventListener("abort", onAbort);
        w.terminate();
        reject(new Error(m.message ?? "sanitize failed"));
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
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort);
    w.addEventListener("message", handler);

    // Copy the source bytes into a fresh transferable buffer so we neuter
    // only the copy — the caller's Uint8Array (often srcBytes still owned
    // by the editor) stays intact until we swap it.
    const copy = new Uint8Array(sourceBytes.byteLength);
    copy.set(sourceBytes);
    const buf = copy.buffer;
    w.postMessage({ kind: "sanitize", id, bytes: buf }, [buf]);
  });
}
