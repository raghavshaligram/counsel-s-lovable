/// <reference lib="webworker" />
/**
 * PII / OCR scan worker.
 *
 * Hosts the entire detect-pii pipeline off the main thread:
 *   - pdf.js document parsing + per-page render (via OffscreenCanvas)
 *   - Tesseract OCR pool (nested workers)
 *   - Transformers.js NER inference
 *   - Regex + heuristic matching
 *
 * The main thread only ships in the file bytes and receives lightweight
 * progress + a serializable result. This keeps every OTHER open tab
 * rendering smoothly during a 5000-page scan — main-thread yields alone
 * are NOT enough to prevent rendering starvation across tabs; the CPU
 * cost has to leave the main thread entirely.
 */

// Re-use the shared detect-pii module. It has been made worker-safe
// (OffscreenCanvas fallback, no toast usage inside a worker).
import { detectPiiInPdf, detectPiiInSideChannels, type DetectProgress } from "@/lib/pdf/detect-pii";

type InboundMsg =
  | { kind: "detect"; id: string; bytes: ArrayBuffer; filename: string; scale: number; skipNer?: boolean }
  | { kind: "detect-side"; id: string; bytes: ArrayBuffer; filename: string }
  | { kind: "cancel"; id: string };

type OutboundMsg =
  | { kind: "progress"; id: string; progress: DetectProgress }
  | { kind: "partial"; id: string; detections: unknown[]; page: number; pass: "regex" | "ner" | "ocr" }
  | { kind: "result"; id: string; result: unknown }
  | { kind: "side-result"; id: string; result: unknown }
  | { kind: "error"; id: string; message: string };

const active = new Map<string, { canceled: boolean }>();

function post(msg: OutboundMsg) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.addEventListener("message", async (ev: MessageEvent<InboundMsg>) => {
  const m = ev.data;
  if (m.kind === "cancel") {
    const entry = active.get(m.id);
    if (entry) entry.canceled = true;
    return;
  }
  if (m.kind === "detect") {
    const entry = { canceled: false };
    active.set(m.id, entry);
    try {
      const file = new File([new Uint8Array(m.bytes)], m.filename, { type: "application/pdf" });
      const result = await detectPiiInPdf(
        file,
        m.scale,
        (progress) => {
          if (entry.canceled) return;
          post({ kind: "progress", id: m.id, progress });
        },
        undefined,
        {
          onPartial: (detections, meta) => {
            if (entry.canceled) return;
            post({ kind: "partial", id: m.id, detections, page: meta.page, pass: meta.pass });
          },
          shouldAbort: () => entry.canceled,
        },
      );
      if (entry.canceled) throw new DOMException("Canceled", "AbortError");
      post({ kind: "result", id: m.id, result });
    } catch (err) {
      post({
        kind: "error",
        id: m.id,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      active.delete(m.id);
    }
    return;
  }
  if (m.kind === "detect-side") {
    const entry = { canceled: false };
    active.set(m.id, entry);
    try {
      const file = new File([new Uint8Array(m.bytes)], m.filename, { type: "application/pdf" });
      const result = await detectPiiInSideChannels(file);
      if (entry.canceled) throw new DOMException("Canceled", "AbortError");
      post({ kind: "side-result", id: m.id, result });
    } catch (err) {
      post({
        kind: "error",
        id: m.id,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      active.delete(m.id);
    }
    return;
  }
});

export {};
