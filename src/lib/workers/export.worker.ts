/// <reference lib="webworker" />
/** Worker host for exportEditedPdf. */
import { exportEditedPdf } from "@/lib/editor/export";
import type { EditorDoc, ExportSettings } from "@/lib/editor/types";

type WorkerDoc = Omit<EditorDoc, "srcBytes"> & { srcBytes: ArrayBuffer };

type InboundMsg =
  | { kind: "export"; id: string; doc: WorkerDoc; settings?: ExportSettings }
  | { kind: "cancel"; id: string };

type OutboundMsg =
  | { kind: "result"; id: string; bytes: ArrayBuffer }
  | { kind: "error"; id: string; message: string };

const canceled = new Set<string>();

function post(msg: OutboundMsg, transfer?: Transferable[]) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

self.addEventListener("message", async (ev: MessageEvent<InboundMsg>) => {
  const m = ev.data;
  if (m.kind === "cancel") {
    canceled.add(m.id);
    return;
  }
  if (m.kind !== "export") return;

  try {
    if (canceled.has(m.id)) throw new DOMException("Canceled", "AbortError");
    const doc: EditorDoc = { ...m.doc, srcBytes: new Uint8Array(m.doc.srcBytes) };
    const out = await exportEditedPdf(doc, m.settings);
    if (canceled.has(m.id)) throw new DOMException("Canceled", "AbortError");
    const outBuf = out.buffer as ArrayBuffer;
    post({ kind: "result", id: m.id, bytes: outBuf }, [outBuf]);
  } catch (err) {
    post({
      kind: "error",
      id: m.id,
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    canceled.delete(m.id);
  }
});

export {};