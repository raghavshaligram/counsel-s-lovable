// PDF → Word (DOCX). Public API is unchanged — the heavy work now runs in
// a dedicated Web Worker (src/lib/pdf/to-word.worker.ts) so the UI stays
// responsive and we can use OffscreenCanvas for faster image encoding.

export type ToWordMode = "flow" | "page" | "fidelity";

export interface ToWordOptions {
  mode?: ToWordMode;
  includeImages?: boolean; // default false (fast text-only)
  fidelityScale?: number; // default 1.5
  concurrency?: number; // default = clamp(navigator.hardwareConcurrency, 2, 8)
  onProgress?: (pct: number, stage?: string) => void;
}

type WorkerOut =
  | { type: "progress"; pct: number; stage: string }
  | { type: "done"; blob: Blob }
  | { type: "error"; message: string };

function pickConcurrency(override?: number): number {
  if (typeof override === "number" && override > 0) return Math.min(8, Math.max(1, override));
  const hw =
    typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 4;
  return Math.max(2, Math.min(8, hw));
}

export async function convertPdfToWordBlob(
  file: File,
  options: ToWordOptions = {},
): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("PDF → Word can only run in the browser");
  }

  const buffer = await file.arrayBuffer();
  const workerOptions = {
    mode: options.mode ?? "flow",
    includeImages: options.includeImages ?? false,
    fidelityScale: options.fidelityScale ?? 1.5,
    concurrency: pickConcurrency(options.concurrency),
  };

  const worker = new Worker(new URL("./to-word.worker.ts", import.meta.url), {
    type: "module",
  });

  try {
    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const msg = e.data;
        if (msg.type === "progress") {
          options.onProgress?.(msg.pct, msg.stage);
        } else if (msg.type === "done") {
          resolve(msg.blob);
        } else if (msg.type === "error") {
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || "Worker error"));
      worker.postMessage({ type: "convert", buffer, options: workerOptions }, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}
