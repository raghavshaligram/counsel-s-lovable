// Lightweight heap + long-task probe for diagnosing tab-switch memory
// pressure. Zero side-effects on production correctness — only console logs.
//
// Usage:
//   import { sampleHeap, startLongTaskWatch } from "@/lib/debug/heap-probe";
//   sampleHeap("switch:before", { tabId });
//
// All output is prefixed with "[heap-probe]" or "[longtask]" so you can grep.

type Perf = Performance & {
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
};

const MB = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

export function sampleHeap(label: string, extra?: Record<string, unknown>): void {
  try {
    const perf = (typeof performance !== "undefined" ? performance : undefined) as Perf | undefined;
    const mem = perf?.memory;
    const payload: Record<string, unknown> = {
      label,
      t: Math.round((perf?.now?.() ?? 0)),
    };
    if (mem) {
      payload.used = MB(mem.usedJSHeapSize);
      payload.total = MB(mem.totalJSHeapSize);
      payload.limit = MB(mem.jsHeapSizeLimit);
      payload.usedBytes = mem.usedJSHeapSize;
    } else {
      payload.note = "performance.memory unavailable (non-Chromium)";
    }
    if (extra) Object.assign(payload, extra);
    // eslint-disable-next-line no-console
    console.log("[heap-probe]", payload);
  } catch {
    /* ignore */
  }
}

let longTaskStarted = false;
export function startLongTaskWatch(thresholdMs = 200): void {
  if (longTaskStarted) return;
  longTaskStarted = true;
  try {
    if (typeof PerformanceObserver === "undefined") return;
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= thresholdMs) {
          // eslint-disable-next-line no-console
          console.log("[longtask]", {
            name: entry.name,
            dur: Math.round(entry.duration),
            start: Math.round(entry.startTime),
          });
        }
      }
    });
    obs.observe({ type: "longtask", buffered: true });
  } catch {
    /* ignore */
  }
}

/**
 * Sum srcBytes across all tabs to see whether background tabs are pinning
 * heavy files in memory. Pass any iterable of tab-like objects.
 */
export function sumSrcBytes(
  tabs: ReadonlyArray<{ editor?: { doc?: { srcBytes?: Uint8Array | null } | null } | null }>,
): { totalBytes: number; withDoc: number } {
  let total = 0;
  let withDoc = 0;
  for (const t of tabs) {
    const b = t?.editor?.doc?.srcBytes;
    if (b && typeof b.byteLength === "number") {
      total += b.byteLength;
      withDoc += 1;
    }
  }
  return { totalBytes: total, withDoc };
}
