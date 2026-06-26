/**
 * Automation pipeline types — shared between runner, worker, and registry.
 *
 * A Pipeline is an ordered list of Steps. Each step names a registered op
 * and carries its params. The runner pipes bytes through: step N's output
 * becomes step N+1's input. No DOM, no UI here.
 */

export interface PipelineStep<P = unknown> {
  /** Registered op name, e.g. "compress" | "watermark" | "rotate". */
  op: string;
  /** Opaque params object handed to the op as-is. */
  params: P;
  /** Optional human label for progress reporting. */
  label?: string;
}

export type Pipeline = PipelineStep[];

export type ProgressEvent =
  | {
      type: "step-start";
      index: number;
      total: number;
      op: string;
      label?: string;
    }
  | {
      type: "step-progress";
      index: number;
      total: number;
      op: string;
      /** 0..1 within the step (op-defined; many ops only emit 0 and 1). */
      pct: number;
      message?: string;
    }
  | {
      type: "step-done";
      index: number;
      total: number;
      op: string;
      /** Output bytes length after this step. */
      outputBytes: number;
      elapsedMs: number;
    }
  | {
      type: "step-error";
      index: number;
      total: number;
      op: string;
      error: string;
    }
  | {
      type: "pipeline-done";
      total: number;
      outputBytes: number;
      elapsedMs: number;
    };

export interface RunResult {
  bytes: Uint8Array;
  steps: Array<{ op: string; outputBytes: number; elapsedMs: number }>;
  totalElapsedMs: number;
}

/** Op signature in the registry: pure bytes -> bytes. */
export type RegisteredOp<P = unknown> = (
  bytes: Uint8Array,
  params: P,
) => Promise<Uint8Array>;
