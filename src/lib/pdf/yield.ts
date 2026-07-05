/**
 * Shared cooperative-yield helper for large-doc pipelines.
 *
 * Every heavy per-page loop (compress, bates, watermark, split, binder,
 * extract, rasterize) MUST await `yieldToUi()` on a bounded cadence so
 * the main thread stays responsive on 1000+ page docs.
 */

export function yieldToUi(): Promise<void> {
  return new Promise((r) => {
    if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
      requestAnimationFrame(() => r());
    } else {
      setTimeout(r, 0);
    }
  });
}

/** Yield roughly every `every` iterations. Cheap noop for other indices. */
export async function maybeYield(i: number, every = 8): Promise<void> {
  if (i > 0 && i % every === 0) await yieldToUi();
}

/** Throw AbortError when a caller-supplied signal is aborted. */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
}
