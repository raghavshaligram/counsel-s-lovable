/**
 * Memory hand-off helpers for worker pipelines.
 *
 * Every stage of the redaction pipeline transfers a large ArrayBuffer to
 * the next worker. Once transferred, the previous worker is `terminate()`d
 * so the OS reclaims its entire heap. These tiny helpers make that pattern
 * uniform across call sites.
 */
import { allocationFailureMessage, logAllocationFailure, logHeap } from "@/lib/memory-log";

/** Get a transferable ArrayBuffer for `src`.
 *
 *  Default (safe): copies the bytes into a fresh buffer so transferring it
 *  does NOT neuter the caller's Uint8Array. Use when the caller still
 *  needs the source bytes (e.g. editor srcBytes).
 *
 *  `{ steal: true }` (zero-copy): returns the caller's own underlying
 *  ArrayBuffer. After `postMessage(..., [buf])` the caller's Uint8Array
 *  becomes empty (byteLength 0). Use in pipelines where the caller drops
 *  its reference immediately — releases that buffer's memory now. */
export function toTransferable(src: Uint8Array, opts?: { steal?: boolean }): ArrayBuffer {
  if (opts?.steal) {
    // If the Uint8Array is a view over a larger buffer, we must copy —
    // transferring the whole buffer would neuter unrelated views.
    if (src.byteOffset !== 0 || src.byteLength !== src.buffer.byteLength) {
      const bytesMB = Math.round((src.byteLength / 1024 / 1024) * 10) / 10;
      logHeap("toTransferable before view copy", { bytesMB, steal: true });
      let copy: Uint8Array;
      try {
        copy = new Uint8Array(src.byteLength);
        copy.set(src);
      } catch (err) {
        logAllocationFailure("toTransferable view copy", err, { bytesMB, steal: true });
        throw new Error(allocationFailureMessage("toTransferable view copy", err));
      }
      return copy.buffer as ArrayBuffer;
    }
    return src.buffer as ArrayBuffer;
  }
  const bytesMB = Math.round((src.byteLength / 1024 / 1024) * 10) / 10;
  logHeap("toTransferable before safe copy", { bytesMB, steal: false });
  let copy: Uint8Array;
  try {
    copy = new Uint8Array(src.byteLength);
    copy.set(src);
  } catch (err) {
    logAllocationFailure("toTransferable safe copy", err, { bytesMB, steal: false });
    throw new Error(allocationFailureMessage("toTransferable safe copy", err));
  }
  return copy.buffer as ArrayBuffer;
}

/** Best-effort: drop references to a Uint8Array's backing buffer so V8
 *  can free it on the next GC. Callers must also null their own refs. */
export function releaseBytes(_u8: Uint8Array | null | undefined): void {
  // No JS API forces GC. This exists as a hook + documentation site — the
  // real release comes from (a) worker.terminate() and (b) callers nulling
  // their own field. Keep it a no-op so callers don't rely on side-effects.
  void _u8;
}
