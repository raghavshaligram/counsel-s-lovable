/// <reference lib="webworker" />
/**
 * Automation Worker — runs a Pipeline off the main thread.
 *
 * Protocol:
 *   main -> worker: { kind: "run", id, pipeline, bytes }   (bytes transferred)
 *   worker -> main: { kind: "progress", id, event }
 *   worker -> main: { kind: "result", id, bytes, steps, totalElapsedMs }
 *                  (bytes transferred)
 *   worker -> main: { kind: "error", id, index, op, message }
 */

import { getOp } from "./registry";
import type { Pipeline, ProgressEvent } from "./types";

type RunMessage = {
  kind: "run";
  id: string;
  pipeline: Pipeline;
  bytes: ArrayBuffer;
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: object, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = async (e: MessageEvent<RunMessage>) => {
  const msg = e.data;
  if (msg?.kind !== "run") return;
  const { id, pipeline } = msg;
  let bytes = new Uint8Array(msg.bytes);

  const t0 = performance.now();
  const stepStats: Array<{ op: string; outputBytes: number; elapsedMs: number }> = [];

  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    const op = getOp(step.op);
    const startEv: ProgressEvent = {
      type: "step-start",
      index: i,
      total: pipeline.length,
      op: step.op,
      label: step.label,
    };
    post({ kind: "progress", id, event: startEv });

    if (!op) {
      const errEv: ProgressEvent = {
        type: "step-error",
        index: i,
        total: pipeline.length,
        op: step.op,
        error: `Unknown op "${step.op}"`,
      };
      post({ kind: "progress", id, event: errEv });
      post({ kind: "error", id, index: i, op: step.op, message: errEv.type === "step-error" ? errEv.error : "unknown" });
      return;
    }

    const tStep = performance.now();
    try {
      const out = await op(bytes, step.params);
      bytes = out;
      const elapsed = performance.now() - tStep;
      stepStats.push({ op: step.op, outputBytes: bytes.byteLength, elapsedMs: elapsed });
      const doneEv: ProgressEvent = {
        type: "step-done",
        index: i,
        total: pipeline.length,
        op: step.op,
        outputBytes: bytes.byteLength,
        elapsedMs: elapsed,
      };
      post({ kind: "progress", id, event: doneEv });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errEv: ProgressEvent = {
        type: "step-error",
        index: i,
        total: pipeline.length,
        op: step.op,
        error: message,
      };
      post({ kind: "progress", id, event: errEv });
      post({ kind: "error", id, index: i, op: step.op, message });
      return;
    }
  }

  const totalElapsedMs = performance.now() - t0;
  const doneEv: ProgressEvent = {
    type: "pipeline-done",
    total: pipeline.length,
    outputBytes: bytes.byteLength,
    elapsedMs: totalElapsedMs,
  };
  post({ kind: "progress", id, event: doneEv });

  // Transfer bytes back to main thread.
  const outBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  post(
    { kind: "result", id, bytes: outBuf, steps: stepStats, totalElapsedMs },
    [outBuf],
  );
};

export {}; // module marker
