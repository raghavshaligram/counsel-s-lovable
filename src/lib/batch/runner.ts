/**
 * Batch Runner — bounded concurrency over a tray-derived queue.
 *
 *   - Pool size = min(hardwareConcurrency - 1, 4), further capped by the
 *     resource tier (conservative = 2).
 *   - Each tool exports a pure op(bytes, opts) => Promise<Uint8Array>.
 *     Ops run on the main thread for now (pdf-lib is sync-ish but releases
 *     between awaits); we hold the bounded slot so the UI stays responsive.
 *     A worker variant can drop in later behind the same signature.
 *   - Per-file failure is isolated. The whole batch completes; failed
 *     files surface as { status: "error" } in the result.
 *   - When >1 file output, results are zipped via fflate.
 */
import { zipSync, type Zippable } from "fflate";
import { detectResources } from "@/lib/workers/resources";
import { getBytes } from "@/lib/tray/blobs";
import type { TrayEntry } from "@/lib/tray/store";

export type BatchOp<O = unknown> = (bytes: Uint8Array, opts: O) => Promise<Uint8Array>;

export type FileStatus =
  | { id: string; name: string; status: "queued" }
  | { id: string; name: string; status: "running" }
  | { id: string; name: string; status: "done"; bytes: Uint8Array; outName: string }
  | { id: string; name: string; status: "error"; error: string };

export interface BatchProgress {
  total: number;
  done: number;
  failed: number;
  files: FileStatus[];
}

export interface RunBatchArgs<O> {
  entries: TrayEntry[];
  op: BatchOp<O>;
  opts: O;
  /** Rename output. Default appends a suffix before .pdf */
  rename?: (entry: TrayEntry, index: number) => string;
  onProgress?: (p: BatchProgress) => void;
  signal?: AbortSignal;
}

const DEFAULT_RENAME = (e: TrayEntry) => e.name.replace(/\.pdf$/i, "") + "-processed.pdf";

export async function runBatch<O>(args: RunBatchArgs<O>): Promise<BatchProgress> {
  const { entries, op, opts, rename = DEFAULT_RENAME, onProgress, signal } = args;
  const res = detectResources();
  const poolSize = Math.min(res.workerPoolSize, 4);

  const files: FileStatus[] = entries.map((e) => ({ id: e.id, name: e.name, status: "queued" }));
  const progress: BatchProgress = { total: entries.length, done: 0, failed: 0, files };
  const emit = () => onProgress?.({ ...progress, files: [...files] });
  emit();

  let cursor = 0;
  async function worker() {
    while (true) {
      if (signal?.aborted) return;
      const i = cursor++;
      if (i >= entries.length) return;
      const entry = entries[i];
      files[i] = { id: entry.id, name: entry.name, status: "running" };
      emit();
      try {
        const bytes = await getBytes(entry.sha256);
        if (!bytes) throw new Error("Bytes not found in tray cache");
        const out = await op(bytes, opts);
        files[i] = { id: entry.id, name: entry.name, status: "done", bytes: out, outName: rename(entry, i) };
        progress.done++;
      } catch (err) {
        files[i] = { id: entry.id, name: entry.name, status: "error", error: err instanceof Error ? err.message : String(err) };
        progress.failed++;
      }
      emit();
    }
  }

  await Promise.all(Array.from({ length: poolSize }, worker));
  return { ...progress, files: [...files] };
}

/** Zip all completed outputs from a batch. */
export function zipBatchOutputs(p: BatchProgress, zipName = "counselpdf-batch.zip"): { bytes: Uint8Array; name: string } {
  const z: Zippable = {};
  for (const f of p.files) {
    if (f.status !== "done") continue;
    let name = f.outName;
    // Avoid name collisions
    let n = 2;
    while (z[name]) {
      name = f.outName.replace(/(\.pdf)?$/i, `-${n}$1`);
      n++;
    }
    z[name] = f.bytes;
  }
  return { bytes: zipSync(z, { level: 6 }), name: zipName };
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/octet-stream") {
  // Copy into a fresh Uint8Array so the Blob owns its memory and the caller
  // can free the source buffer immediately after this returns.
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Revoke the object URL after the browser has had time to start the
    // download. Without this, blob URLs accumulate and memory is never freed
    // — repeated exports eventually wedge the tab.
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }, 4000);
  }
}

