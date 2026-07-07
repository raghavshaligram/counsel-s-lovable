/**
 * Main-thread client for the PII / OCR scan worker.
 *
 * Every large-doc scan goes through here so pdf.js render + Tesseract +
 * Transformers.js inference execute in a dedicated Web Worker. The main
 * thread stays free to render every open tab smoothly during the scan —
 * yields on the main thread aren't enough to prevent rendering
 * starvation across tabs; the CPU cost has to actually leave the thread.
 *
 * Progress is streamed back over postMessage as lightweight objects.
 * The API mirrors detectPiiInPdf so callers only change the import.
 */
import type { Detection, DetectProgress } from "@/lib/pdf/detect-pii";

export type DetectResult = {
  detections: Detection[];
  usedOcr: boolean;
  scannedPages: number[];
  totalPages: number;
  lowConfidenceOcrPages: number[];
  ocrPageConfidence: Record<number, number>;
  ocrUnderDetectedPages: number[];
};

let reqCounter = 0;

function createWorker(): Worker {
  return new Worker(new URL("./detect-pii.worker.ts", import.meta.url), {
    type: "module",
    name: "counselpdf-detect-pii",
  });
}

interface OutboundMsg {
  kind: "progress" | "partial" | "result" | "side-result" | "error";
  id: string;
  progress?: DetectProgress;
  detections?: Detection[];
  page?: number;
  pass?: "regex" | "ner" | "ocr";
  result?: unknown;
  message?: string;
}

/**
 * Scan a PDF for PII in a dedicated worker. Signature matches
 * detectPiiInPdf so callers only need to swap the import.
 *
 * `onPartial` receives incremental detections as they're found: regex
 * findings after each page, NER findings after each cross-page batch,
 * OCR findings after each scanned page. This lets the UI show results
 * live within seconds instead of waiting for the whole scan.
 */
export function detectPiiInPdfViaWorker(
  file: File,
  scale = 1.5,
  onProgress?: (p: DetectProgress) => void,
  signal?: AbortSignal,
  onPartial?: (detections: Detection[], meta: { page: number; pass: "regex" | "ner" | "ocr" }) => void,
  opts?: { skipNer?: boolean },
): Promise<DetectResult> {
  return new Promise<DetectResult>((resolve, reject) => {
    (async () => {
      try {
        const w = createWorker();
        const id = `det-${++reqCounter}`;
        const bytes = await file.arrayBuffer();
        let settled = false;

        // Coalesce worker→main callbacks per animation frame. The scan
        // worker can emit hundreds of progress + partial messages per
        // second on a large doc; if each triggered a synchronous React
        // state update the main thread's task queue would stay saturated
        // and starve unrelated main-thread work — most visibly the
        // "open a new PDF" path (arrayBuffer read + pdf.js structured
        // clone). Keep the worker running full speed and cap main-thread
        // updates at ~60/sec via RAF batching (latest-only progress,
        // append-all partials).
        let pendingProgress: DetectProgress | null = null;
        let pendingPartials: Array<{ dets: Detection[]; meta: { page: number; pass: "regex" | "ner" | "ocr" } }> = [];
        let flushScheduled = false;
        const schedule =
          typeof requestAnimationFrame === "function"
            ? (cb: () => void) => requestAnimationFrame(cb)
            : (cb: () => void) => setTimeout(cb, 16);
        const flush = () => {
          flushScheduled = false;
          const prog = pendingProgress;
          const parts = pendingPartials;
          pendingProgress = null;
          pendingPartials = [];
          if (prog && onProgress) {
            try { onProgress(prog); } catch (e) { console.warn("[detect] onProgress threw", e); }
          }
          if (parts.length && onPartial) {
            for (const p of parts) {
              try { onPartial(p.dets, p.meta); } catch (e) { console.warn("[detect] onPartial threw", e); }
            }
          }
        };
        const ensureFlush = () => {
          if (flushScheduled) return;
          flushScheduled = true;
          schedule(flush);
        };

        const handler = (ev: MessageEvent<OutboundMsg>) => {
          const m = ev.data;
          if (m.id !== id) return;
          if (m.kind === "progress" && m.progress) {
            pendingProgress = m.progress; // latest-only
            ensureFlush();
          } else if (m.kind === "partial" && m.detections && typeof m.page === "number" && m.pass) {
            pendingPartials.push({ dets: m.detections as Detection[], meta: { page: m.page, pass: m.pass } });
            ensureFlush();
          } else if (m.kind === "result") {
            if (settled) return;
            settled = true;
            w.removeEventListener("message", handler);
            signal?.removeEventListener("abort", onAbort);
            if (flushScheduled) flush();
            w.terminate();
            resolve(m.result as DetectResult);
          } else if (m.kind === "error") {
            if (settled) return;
            settled = true;
            w.removeEventListener("message", handler);
            signal?.removeEventListener("abort", onAbort);
            w.terminate();
            reject(new Error(m.message ?? "scan failed"));
          }
        };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          w.postMessage({ kind: "cancel", id });
          w.removeEventListener("message", handler);
          w.terminate();
          reject(new DOMException("Canceled", "AbortError"));
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort);
        w.addEventListener("message", handler);
        // Transfer the ArrayBuffer so the main thread doesn't hold a
        // second copy of a large PDF in memory during the scan.
        w.postMessage(
          { kind: "detect", id, bytes, filename: file.name, scale },
          [bytes],
        );
      } catch (err) {
        reject(err);
      }
    })();
  });
}

/**
 * Side-channel scan (form fields / annotations / metadata) inside the
 * worker so the main thread stays free.
 */
export function detectPiiInSideChannelsViaWorker(
  file: File,
  signal?: AbortSignal,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const w = createWorker();
        const id = `side-${++reqCounter}`;
        const bytes = await file.arrayBuffer();
        let settled = false;
        const handler = (ev: MessageEvent<OutboundMsg>) => {
          const m = ev.data;
          if (m.id !== id) return;
          if (m.kind === "side-result") {
            if (settled) return;
            settled = true;
            w.removeEventListener("message", handler);
            signal?.removeEventListener("abort", onAbort);
            w.terminate();
            resolve((m.result as unknown[]) ?? []);
          } else if (m.kind === "error") {
            if (settled) return;
            settled = true;
            w.removeEventListener("message", handler);
            signal?.removeEventListener("abort", onAbort);
            w.terminate();
            reject(new Error(m.message ?? "side scan failed"));
          }
        };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          w.postMessage({ kind: "cancel", id });
          w.removeEventListener("message", handler);
          w.terminate();
          reject(new DOMException("Canceled", "AbortError"));
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort);
        w.addEventListener("message", handler);
        w.postMessage(
          { kind: "detect-side", id, bytes, filename: file.name },
          [bytes],
        );
      } catch (err) {
        reject(err);
      }
    })();
  });
}
