/**
 * Main-thread client for the sanitize worker. Mirrors sanitizePdfBytesWithReport
 * but keeps the pdf-lib parse + save off the main thread so 5000-page
 * documents don't lock the UI or OOM the tab.
 */
import type { SanitizeReport } from "@/lib/pdf/sanitize";
import type { VerifyLeak } from "@/lib/editor/verify-redaction";
import { toTransferable } from "./release";

export interface SanitizeProgress {
  stage: string;
  done: number;
  total: number;
}

export interface SanitizeResult {
  bytes: Uint8Array;
  report: SanitizeReport;
  pageCount: number;
  sideLeaks?: VerifyLeak[];
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
  sideLeaks?: VerifyLeak[];
  message?: string;
}

export function sanitizeInWorker(
  sourceBytes: Uint8Array,
  opts: {
    onProgress?: (p: SanitizeProgress) => void;
    signal?: AbortSignal;
    /** Optional same-worker side-channel verification. Keeps the sanitized
     *  PDF from being copied into a second worker for another full parse. */
    sideVerifyStrings?: string[];
    /** Transfer the caller's ArrayBuffer to the worker (zero-copy).
     *  After the call, the caller's Uint8Array is empty. Use only when the
     *  caller will not read that byte buffer again. */
    stealBytes?: boolean;
    /** When provided, ONLY these form fields (matched by /T) are cleared;
     *  other form fields are left intact. Used by the redaction panel to
     *  clear one selected finding at a time. Omit to keep the standalone
     *  Sanitize tool's blanket-clear behavior. */
    targetFieldNames?: string[];
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
        resolve({ bytes: new Uint8Array(m.bytes), report: m.report, pageCount: m.pageCount, sideLeaks: m.sideLeaks });
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

    // Default is safe-copy so editor-owned srcBytes stay intact. Pipeline
    // callers can opt into zero-copy transfer with stealBytes to avoid
    // holding two full copies of a huge PDF during redaction export.
    const buf = toTransferable(sourceBytes, { steal: opts.stealBytes });
    w.postMessage({ kind: "sanitize", id, bytes: buf, sideVerifyStrings: opts.sideVerifyStrings ?? [] }, [buf]);
  });
}
