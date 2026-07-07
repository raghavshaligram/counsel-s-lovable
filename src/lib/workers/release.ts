/**
 * Memory hand-off helpers for worker pipelines.
 *
 * Every stage of the redaction pipeline transfers a large ArrayBuffer to
 * the next worker. Once transferred, the previous worker is `terminate()`d
 * so the OS reclaims its entire heap. These tiny helpers make that pattern
 * uniform across call sites.
 */

/** Copy `src` into a fresh, transferable ArrayBuffer. Never returns the
 *  caller's underlying buffer — safe to `transfer` without neutering the
 *  caller's Uint8Array. */
export function toTransferable(src: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(src.byteLength);
  copy.set(src);
  return copy.buffer;
}

/** Best-effort: drop references to a Uint8Array's backing buffer so V8
 *  can free it on the next GC. Callers must also null their own refs. */
export function releaseBytes(_u8: Uint8Array | null | undefined): void {
  // No JS API forces GC. This exists as a hook + documentation site — the
  // real release comes from (a) worker.terminate() and (b) callers nulling
  // their own field. Keep it a no-op so callers don't rely on side-effects.
  void _u8;
}
