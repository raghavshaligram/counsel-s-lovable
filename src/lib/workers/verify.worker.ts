/// <reference lib="webworker" />
/**
 * Verify worker — runs verifyRedactionRemoval / verifySideChannelVectors
 * off the main thread.
 *
 * Full-document scan (page geometry via pdf.js + raw stream + side-channel
 * dicts via pdf-lib) all happens inside this worker. It's terminated the
 * moment it returns so the whole verification heap is released.
 */
import {
  verifyRedactionRemoval,
  verifySideChannelVectors,
  type RedactionTarget,
  type VerifyLeak,
  type VerifyResult,
} from "@/lib/editor/verify-redaction";

type InboundMsg =
  | {
      kind: "verify";
      id: string;
      bytes: ArrayBuffer;
      targets: RedactionTarget[];
      rasterizedPages: number[];
    }
  | {
      kind: "verify-side-channel";
      id: string;
      bytes: ArrayBuffer;
      sensitiveStrings: string[];
    }
  | { kind: "cancel"; id: string };

type OutboundMsg =
  | { kind: "progress"; id: string; stage: string; done: number; total: number }
  | { kind: "result"; id: string; result: VerifyResult }
  | { kind: "side-channel-result"; id: string; leaks: VerifyLeak[] }
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

  const ctrl = new AbortController();
  active.set(m.id, { ctrl });
  try {
    if (m.kind === "verify") {
      const bytes = new Uint8Array(m.bytes);
      const result = await verifyRedactionRemoval(bytes, m.targets, {
        rasterizedPages: m.rasterizedPages,
        signal: ctrl.signal,
        onProgress: (stage, done, total) => post({ kind: "progress", id: m.id, stage, done, total }),
      });
      post({ kind: "result", id: m.id, result });
    } else if (m.kind === "verify-side-channel") {
      // Side-channel-only verification: pdf-lib parse + AcroForm walk +
      // per-page Annots walk + single enumerateIndirectObjects pass. All
      // synchronous inside verifySideChannelVectors, but running here keeps
      // the main thread free while the 5000-page indirect graph is walked.
      post({ kind: "progress", id: m.id, stage: "side-channel", done: 0, total: 1 });
      const bytes = new Uint8Array(m.bytes);
      const leaks = await verifySideChannelVectors(bytes, m.sensitiveStrings);
      post({ kind: "progress", id: m.id, stage: "side-channel", done: 1, total: 1 });
      post({ kind: "side-channel-result", id: m.id, leaks });
    }
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

