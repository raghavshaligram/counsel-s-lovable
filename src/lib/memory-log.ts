type PerformanceMemory = {
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
};

type PerformanceWithMemory = Performance & { memory?: PerformanceMemory };

export type MemoryLogMeta = Record<string, unknown>;

function mb(value: number | undefined): number | null {
  return typeof value === "number" ? Math.round((value / 1024 / 1024) * 10) / 10 : null;
}

export function heapSnapshot(): Record<string, unknown> {
  const perf = globalThis.performance as PerformanceWithMemory | undefined;
  const memory = perf?.memory;
  return {
    usedMB: mb(memory?.usedJSHeapSize),
    totalMB: mb(memory?.totalJSHeapSize),
    limitMB: mb(memory?.jsHeapSizeLimit),
    memoryAvailable: !!memory,
    timestamp: new Date().toISOString(),
  };
}

export function logHeap(label: string, meta: MemoryLogMeta = {}): void {
  // eslint-disable-next-line no-console
  console.info("[mem:redact-export]", {
    label,
    ...heapSnapshot(),
    ...meta,
  });
}

export function logAllocationFailure(label: string, err: unknown, meta: MemoryLogMeta = {}): void {
  const error = err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : { name: "NonError", message: String(err), stack: undefined };
  // eslint-disable-next-line no-console
  console.error("[mem:redact-export:allocation-failed]", {
    label,
    ...heapSnapshot(),
    ...meta,
    error,
  });
}

export function allocationFailureMessage(label: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `${label}: ${message}`;
}