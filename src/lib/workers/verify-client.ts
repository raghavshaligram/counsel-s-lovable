/**
 * Main-thread client for the verify worker. Fresh worker per call,
 * terminated on completion so the pdf-lib indirect-object graph and
 * pdf.js doc are released in one shot.
 */
import { toTransferable } from "./release";
import type { RedactionTarget, VerifyLeak, VerifyResult } from "@/lib/editor/verify-redaction";

let reqCounter = 0;

function createWorker(): Worker {
  return new Worker(new URL("./verify.worker.ts", import.meta.url), {
    type: "module",
    name: "pdfmacro-verify",
  });
}

interface OutboundMsg {
  kind: "progress" | "result" | "side-channel-result" | "error";
  id: string;
  stage?: string;
  done?: number;
  total?: number;
  result?: VerifyResult;
  leaks?: VerifyLeak[];
  message?: string;
}

export function verifyRedactionRemovalInWorker(
  bytes: Uint8Array,
  targets: RedactionTarget[],
  opts: {
    rasterizedPages?: number[];
    signal?: AbortSignal;
    onProgress?: (stage: string, done: number, total: number) => void;
    /** Transfer the caller's ArrayBuffer to the worker (zero-copy).
     *  After the call, the caller's Uint8Array is empty. */
    stealBytes?: boolean;
  } = {},
): Promise<VerifyResult> {
  return new Promise<VerifyResult>((resolve, reject) => {
    const w = createWorker();
    const id = `ver-${++reqCounter}`;
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
      if (m.kind === "progress") {
        try { opts.onProgress?.(m.stage ?? "", m.done ?? 0, m.total ?? 0); } catch { /* ignore */ }
      } else if (m.kind === "result" && m.result) {
        finish(() => resolve(m.result!));
      } else if (m.kind === "error") {
        finish(() => reject(new Error(m.message ?? "verify failed")));
      }
    };
    const onAbort = () => {
      try { w.postMessage({ kind: "cancel", id }); } catch { /* ignore */ }
      finish(() => reject(new DOMException("Canceled", "AbortError")));
    };
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort);
    w.addEventListener("message", handler);

    const buf = toTransferable(bytes, { steal: opts.stealBytes });
    w.postMessage(
      {
        kind: "verify",
        id,
        bytes: buf,
        targets,
        rasterizedPages: opts.rasterizedPages ?? [],
      },
      [buf],
    );
  });
}

/**
 * Side-channel-only verification off the main thread. Mirrors
 * `verifySideChannelVectors` from `verify-redaction.ts` — pdf-lib parse +
 * AcroForm walk + per-page Annots walk + one enumerateIndirectObjects pass —
 * but on 5000-page docs the indirect graph walk alone blocks the main thread
 * for many seconds and triggers "Page Unresponsive". Runs here instead.
 *
 * Contract is identical: returns the list of leaks. An empty array means the
 * sensitive strings were NOT found in any side-channel dict; the caller
 * MUST still fail-closed if the array is non-empty.
 */
export function verifySideChannelInWorker(
  bytes: Uint8Array,
  sensitiveStrings: string[],
  opts: {
    signal?: AbortSignal;
    onProgress?: (stage: string, done: number, total: number) => void;
    stealBytes?: boolean;
  } = {},
): Promise<VerifyLeak[]> {
  return new Promise<VerifyLeak[]>((resolve, reject) => {
    const w = createWorker();
    const id = `verSide-${++reqCounter}`;
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
      if (m.kind === "progress") {
        try { opts.onProgress?.(m.stage ?? "", m.done ?? 0, m.total ?? 0); } catch { /* ignore */ }
      } else if (m.kind === "side-channel-result" && Array.isArray(m.leaks)) {
        finish(() => resolve(m.leaks!));
      } else if (m.kind === "error") {
        finish(() => reject(new Error(m.message ?? "verify failed")));
      }
    };
    const onAbort = () => {
      try { w.postMessage({ kind: "cancel", id }); } catch { /* ignore */ }
      finish(() => reject(new DOMException("Canceled", "AbortError")));
    };
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort);
    w.addEventListener("message", handler);

    const buf = toTransferable(bytes, { steal: opts.stealBytes });
    w.postMessage(
      { kind: "verify-side-channel", id, bytes: buf, sensitiveStrings },
      [buf],
    );
  });
}
