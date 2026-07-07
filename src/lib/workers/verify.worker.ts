/// <reference lib="webworker" />
/**
 * Verify worker — runs verifyRedactionRemoval off the main thread.
 *
 * Full-document scan (page geometry via pdf.js + raw stream + side-channel
 * dicts via pdf-lib) all happens inside this worker. It's terminated the
 * moment it returns so the whole verification heap is released.
 */
import { verifyRedactionRemoval, type RedactionTarget, type VerifyResult } from "@/lib/editor/verify-redaction";

type InboundMsg =
  | {
      kind: "verify";
      id: string;
      bytes: ArrayBuffer;
      targets: RedactionTarget[];
      rasterizedPages: number[];
    }
  | { kind: "cancel"; id: string };

type OutboundMsg =
  | { kind: "progress"; id: string; stage: string; done: number; total: number }
  | { kind: "result"; id: string; result: VerifyResult }
  | { kind: "error"; id: string; message: string };

const active = new Map<string, { ctrl: AbortController }>();

function post(msg: OutboundMsg) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.addEventListener("message", async (ev: MessageEvent<InboundMsg>) => {
  const m = ev.data;
  if (m.kind === "cancel") {
    const e = active.get(m.id);
    if (e) { try { e.ctrl.abort(); } catch { /* noop */ } }
    return;
  }
  if (m.kind !== "verify") return;

  const ctrl = new AbortController();
  active.set(m.id, { ctrl });
  try {
    const bytes = new Uint8Array(m.bytes);
    const result = await verifyRedactionRemoval(bytes, m.targets, {
      rasterizedPages: m.rasterizedPages,
      signal: ctrl.signal,
      onProgress: (stage, done, total) => post({ kind: "progress", id: m.id, stage, done, total }),
    });
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
});

export {};
