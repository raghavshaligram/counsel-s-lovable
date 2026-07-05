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

let worker: Worker | null = null;
let reqCounter = 0;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./detect-pii.worker.ts", import.meta.url), {
    type: "module",
    name: "counselpdf-detect-pii",
  });
  return worker;
}

interface OutboundMsg {
  kind: "progress" | "result" | "side-result" | "error";
  id: string;
  progress?: DetectProgress;
  result?: unknown;
  message?: string;
}

/**
 * Scan a PDF for PII in a dedicated worker. Signature matches
 * detectPiiInPdf so callers only need to swap the import.
 */
export function detectPiiInPdfViaWorker(
  file: File,
  scale = 1.5,
  onProgress?: (p: DetectProgress) => void,
  signal?: AbortSignal,
): Promise<DetectResult> {
  return new Promise<DetectResult>((resolve, reject) => {
    (async () => {
      try {
        const w = getWorker();
        const id = `det-${++reqCounter}`;
        const bytes = await file.arrayBuffer();

        const handler = (ev: MessageEvent<OutboundMsg>) => {
          const m = ev.data;
          if (m.id !== id) return;
          if (m.kind === "progress" && m.progress) {
            onProgress?.(m.progress);
          } else if (m.kind === "result") {
            w.removeEventListener("message", handler);
            signal?.removeEventListener("abort", onAbort);
            resolve(m.result as DetectResult);
          } else if (m.kind === "error") {
            w.removeEventListener("message", handler);
            signal?.removeEventListener("abort", onAbort);
            reject(new Error(m.message ?? "scan failed"));
          }
        };
        const onAbort = () => {
          w.postMessage({ kind: "cancel", id });
          w.removeEventListener("message", handler);
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
        const w = getWorker();
        const id = `side-${++reqCounter}`;
        const bytes = await file.arrayBuffer();
        const handler = (ev: MessageEvent<OutboundMsg>) => {
          const m = ev.data;
          if (m.id !== id) return;
          if (m.kind === "side-result") {
            w.removeEventListener("message", handler);
            signal?.removeEventListener("abort", onAbort);
            resolve((m.result as unknown[]) ?? []);
          } else if (m.kind === "error") {
            w.removeEventListener("message", handler);
            signal?.removeEventListener("abort", onAbort);
            reject(new Error(m.message ?? "side scan failed"));
          }
        };
        const onAbort = () => {
          w.postMessage({ kind: "cancel", id });
          w.removeEventListener("message", handler);
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
