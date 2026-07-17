/**
 * Main-thread client for editor PDF export. Redaction export can rebuild
 * thousands of pages before rasterize/sanitize/verify starts, so run the
 * pdf-lib copy/rewrite/save stage off the UI thread as well.
 */
import type { EditorDoc, ExportSettings } from "@/lib/editor/types";
import { toTransferable } from "./release";

interface OutboundMsg {
  kind: "result" | "error";
  id: string;
  bytes?: ArrayBuffer;
  message?: string;
}

let reqCounter = 0;

function createWorker(): Worker {
  return new Worker(new URL("./export.worker.ts", import.meta.url), {
    type: "module",
    name: "pdfmacro-export",
  });
}

export function exportEditedPdfInWorker(
  doc: EditorDoc,
  settings?: ExportSettings,
  opts: { signal?: AbortSignal; stealBytes?: boolean } = {},
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const w = createWorker();
    const id = `export-${++reqCounter}`;
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
      if (m.kind === "result" && m.bytes) {
        finish(() => resolve(new Uint8Array(m.bytes!)));
      } else if (m.kind === "error") {
        finish(() => reject(new Error(m.message ?? "export failed")));
      }
    };

    const onAbort = () => {
      try { w.postMessage({ kind: "cancel", id }); } catch { /* noop */ }
      finish(() => reject(new DOMException("Canceled", "AbortError")));
    };

    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort);
    w.addEventListener("message", handler);

    const buf = toTransferable(doc.srcBytes, { steal: opts.stealBytes });
    const workerDoc = { ...doc, srcBytes: buf };
    w.postMessage({ kind: "export", id, doc: workerDoc, settings }, [buf]);
  });
}