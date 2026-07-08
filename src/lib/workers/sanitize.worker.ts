/// <reference lib="webworker" />
/**
 * Sanitize worker — hosts sanitizePdfBytesWithReport off the main thread
 * so wiping form fields / annotations / metadata on a 5000-page PDF does
 * not block the UI or OOM the tab (pdf-lib parse + save keeps a large
 * indirect-object graph in memory).
 */
import { sanitizePdfBytesWithReport, type SanitizeReport } from "@/lib/pdf/sanitize";
import type { VerifyLeak } from "@/lib/editor/verify-redaction";

type InboundMsg =
  | { kind: "sanitize"; id: string; bytes: ArrayBuffer; sideVerifyStrings?: string[]; targetFieldNames?: string[] }
  | { kind: "cancel"; id: string };

type OutboundMsg =
  | { kind: "progress"; id: string; stage: string; done: number; total: number }
  | { kind: "result"; id: string; bytes: ArrayBuffer; report: SanitizeReport; pageCount: number; sideLeaks?: VerifyLeak[] }
  | { kind: "error"; id: string; message: string };

const active = new Map<string, { canceled: boolean }>();

function post(msg: OutboundMsg, transfer?: Transferable[]) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

self.addEventListener("message", async (ev: MessageEvent<InboundMsg>) => {
  const m = ev.data;
  if (m.kind === "cancel") {
    const entry = active.get(m.id);
    if (entry) entry.canceled = true;
    return;
  }
  if (m.kind === "sanitize") {
    const entry = { canceled: false };
    active.set(m.id, entry);
    try {
      const bytes = new Uint8Array(m.bytes);
      const { bytes: out, report, pageCount } = await sanitizePdfBytesWithReport(bytes, {
        onProgress: (stage, done, total) => {
          if (entry.canceled) return;
          post({ kind: "progress", id: m.id, stage, done, total });
        },
        shouldAbort: () => entry.canceled,
        ...(m.targetFieldNames && m.targetFieldNames.length > 0
          ? { targetFieldNames: m.targetFieldNames }
          : {}),
      });
      if (entry.canceled) throw new DOMException("Canceled", "AbortError");
      let sideLeaks: VerifyLeak[] | undefined;
      const sideVerifyStrings = Array.from(new Set((m.sideVerifyStrings ?? []).map((s) => s.trim()).filter((s) => s.length >= 3)));
      if (sideVerifyStrings.length > 0) {
        const { verifySideChannelVectors } = await import("@/lib/editor/verify-redaction");
        post({ kind: "progress", id: m.id, stage: "verify-side-channel", done: 0, total: 1 });
        sideLeaks = await verifySideChannelVectors(out, sideVerifyStrings);
        if (entry.canceled) throw new DOMException("Canceled", "AbortError");
        post({ kind: "progress", id: m.id, stage: "verify-side-channel", done: 1, total: 1 });
      }
      // Transfer the output buffer back to the main thread; do not keep a copy here.
      const outBuf = out.buffer as ArrayBuffer;
      post({ kind: "result", id: m.id, bytes: outBuf, report, pageCount, sideLeaks }, [outBuf]);
    } catch (err) {
      post({
        kind: "error",
        id: m.id,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      active.delete(m.id);
    }
  }
});

export {};
