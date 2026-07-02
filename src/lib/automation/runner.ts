/**
 * Automation Runner — main-thread API. Executes a Pipeline step-by-step:
 *   - Worker-eligible ops run inside a shared dedicated Web Worker.
 *   - DOM-bound ops (OCR, pattern redact) run inline on the main thread
 *     via the main-thread registry, reusing the app's verified engines.
 *
 * Privacy: nothing leaves the browser.
 */

import type { Pipeline, PipelineStep, ProgressEvent, RunResult } from "./types";
import { getMainOp, isMainThreadOp } from "./main-registry";
import { evaluateCondition, makeConditionContext, type ConditionContext } from "./conditions";

let cachedWorker: Worker | null = null;
function getWorker(): Worker {
  if (cachedWorker) return cachedWorker;
  cachedWorker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "counselpdf-automation",
  });
  return cachedWorker;
}

export interface RunPipelineOptions {
  onProgress?: (ev: ProgressEvent) => void;
  signal?: AbortSignal;
}

let runCounter = 0;

/** Run a single worker step and return its bytes + elapsed time. */
function runWorkerStep(
  bytes: Uint8Array,
  step: PipelineStep,
  stepIndex: number,
  totalSteps: number,
  onProgress?: (ev: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; elapsedMs: number }> {
  const id = `run-${++runCounter}-${Date.now()}`;
  const worker = getWorker();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.id !== id) return;
      if (m.kind === "progress") {
        const ev = m.event as ProgressEvent;
        // Re-index events from the single-step sub-pipeline (index 0) into
        // the outer pipeline coordinates.
        if ("index" in ev) {
          onProgress?.({ ...ev, index: stepIndex, total: totalSteps });
        }
        return;
      }
      if (m.kind === "result") {
        cleanup();
        resolve({
          bytes: new Uint8Array(m.bytes as ArrayBuffer),
          elapsedMs: m.totalElapsedMs as number,
        });
        return;
      }
      if (m.kind === "error") {
        cleanup();
        const err = new Error(
          `Step ${stepIndex} (${m.op}) failed: ${m.message}`,
        ) as Error & { stepIndex?: number; op?: string };
        err.stepIndex = stepIndex;
        err.op = m.op;
        reject(err);
        return;
      }
    };
    const onErr = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(`Worker error: ${e.message}`));
    };
    const onAbort = () => {
      cleanup();
      try { worker.terminate(); } catch { /* noop */ }
      cachedWorker = null;
      reject(new DOMException("Aborted", "AbortError"));
    };

    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    signal?.addEventListener("abort", onAbort, { once: true });

    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    worker.postMessage(
      { kind: "run", id, pipeline: [step] as Pipeline, bytes: buf },
      [buf],
    );
  });
}

export async function runPipeline(
  bytes: Uint8Array,
  pipeline: Pipeline,
  opts: RunPipelineOptions = {},
): Promise<RunResult> {
  const total = pipeline.length;
  const stepStats: Array<{ op: string; outputBytes: number; elapsedMs: number }> = [];
  const t0 = performance.now();
  let cur = bytes;
  // Per-run condition cache — the pdf.js text scan is heavy; do it once
  // per distinct input buffer. Reset whenever `cur` changes.
  let condCtx: ConditionContext = makeConditionContext(cur);
  let condCtxFor = cur;

  for (let i = 0; i < pipeline.length; i++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const step = pipeline[i];

    // Refresh condition cache when the byte buffer changed (previous op
    // rewrote the doc, so any text-layer check must be re-run).
    if (cur !== condCtxFor) {
      condCtx = makeConditionContext(cur);
      condCtxFor = cur;
    }

    if (step.condition && step.condition.kind !== "always") {
      const res = await evaluateCondition(step.condition, condCtx);
      if (!res.passed) {
        opts.onProgress?.({
          type: "step-skipped",
          index: i,
          total,
          op: step.op,
          reason: res.reason,
        });
        continue;
      }
    }

    if (isMainThreadOp(step.op)) {
      // Emit step-start manually — worker emits its own; here we do it.
      opts.onProgress?.({
        type: "step-start",
        index: i,
        total,
        op: step.op,
        label: step.label,
      });
      const tStep = performance.now();
      try {
        const op = getMainOp(step.op, (ev) => opts.onProgress?.(ev), i, total);
        if (!op) throw new Error(`Unknown main-thread op "${step.op}"`);
        const out = await op(cur, step.params);
        cur = out;
        const elapsed = performance.now() - tStep;
        stepStats.push({ op: step.op, outputBytes: cur.byteLength, elapsedMs: elapsed });
        opts.onProgress?.({
          type: "step-done",
          index: i,
          total,
          op: step.op,
          outputBytes: cur.byteLength,
          elapsedMs: elapsed,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.onProgress?.({
          type: "step-error",
          index: i,
          total,
          op: step.op,
          error: message,
        });
        const e = new Error(`Step ${i} (${step.op}) failed: ${message}`) as Error & {
          stepIndex?: number; op?: string;
        };
        e.stepIndex = i;
        e.op = step.op;
        throw e;
      }
    } else {
      const { bytes: out, elapsedMs } = await runWorkerStep(
        cur,
        step,
        i,
        total,
        opts.onProgress,
        opts.signal,
      );
      cur = out;
      stepStats.push({ op: step.op, outputBytes: cur.byteLength, elapsedMs });
    }
  }

  const totalElapsedMs = performance.now() - t0;
  opts.onProgress?.({
    type: "pipeline-done",
    total,
    outputBytes: cur.byteLength,
    elapsedMs: totalElapsedMs,
  });
  return { bytes: cur, steps: stepStats, totalElapsedMs };
}

/** Convenience: download the result as a file. */
export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
