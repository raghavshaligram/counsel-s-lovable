/// <reference lib="webworker" />
/**
 * Bates worker — runs addBatesWithMeta off the main thread so stamping
 * a 5000-page document doesn't lock the UI while pdf-lib parses + saves.
 */
import { addBatesWithMeta, type BatesOpts } from "@/lib/batch/ops/bates";

type InboundMsg =
  | { kind: "stamp"; id: string; bytes: ArrayBuffer; opts: BatesOpts }
  | { kind: "cancel"; id: string };

type OutboundMsg =
  | { kind: "progress"; id: string; done: number; total: number }
  | { kind: "result"; id: string; bytes: ArrayBuffer; pageCount: number }
  | { kind: "error"; id: string; message: string };

const active = new Map<string, { canceled: boolean; ctrl: AbortController }>();

function post(msg: OutboundMsg, transfer?: Transferable[]) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

self.addEventListener("message", async (ev: MessageEvent<InboundMsg>) => {
  const m = ev.data;
  if (m.kind === "cancel") {
    const entry = active.get(m.id);
    if (entry) {
      entry.canceled = true;
      try { entry.ctrl.abort(); } catch { /* ignore */ }
    }
    return;
  }
  if (m.kind === "stamp") {
    const ctrl = new AbortController();
    const entry = { canceled: false, ctrl };
    active.set(m.id, entry);
    try {
      const bytes = new Uint8Array(m.bytes);
      const { bytes: out, pageCount } = await addBatesWithMeta(bytes, m.opts, {
        signal: ctrl.signal,
        onProgress: (done, total) => {
          if (entry.canceled) return;
          // Throttle: only every 64 pages or the very last.
          if (done === total || done % 64 === 0) {
            post({ kind: "progress", id: m.id, done, total });
          }
        },
      });
      if (entry.canceled) throw new DOMException("Canceled", "AbortError");
      const outBuf = out.buffer as ArrayBuffer;
      post({ kind: "result", id: m.id, bytes: outBuf, pageCount }, [outBuf]);
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
