/**
 * runtime-pressure — global listener that catches memory / quota
 * exceptions and dispatches a single debounced `counselpdf:memory-pressure`
 * CustomEvent. The workspace banner subscribes and offers a one-click
 * reload to purge in-RAM caches.
 */

const PRESSURE_EVENT = "counselpdf:memory-pressure";
const CLEAR_EVENT = "counselpdf:memory-pressure-clear";

const PATTERNS: RegExp[] = [
  /QuotaExceeded/i,
  /NS_ERROR_DOM_QUOTA/i,
  /out of memory/i,
  /Array\s?Buffer/i,
  /Maximum call stack/i,
  /Failed to allocate/i,
  /Worker was destroyed/i,
  /allocation failed/i,
];

const QUOTA_NAMES = new Set(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"]);

let installed = false;
let lastDispatch = 0;
const DEBOUNCE_MS = 5000;

function messageFrom(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) {
    return `${err.name ?? ""}: ${err.message ?? ""} ${err.stack ?? ""}`;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function classify(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof DOMException && QUOTA_NAMES.has(err.name)) {
    return `quota:${err.name}`;
  }
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name?: string }).name;
    if (name && QUOTA_NAMES.has(name)) return `quota:${name}`;
  }
  const msg = messageFrom(err);
  if (!msg) return null;
  for (const re of PATTERNS) {
    if (re.test(msg)) return msg.slice(0, 200);
  }
  return null;
}

export function reportMemoryPressure(reason: string): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastDispatch < DEBOUNCE_MS) return;
  lastDispatch = now;
  try {
    window.dispatchEvent(new CustomEvent(PRESSURE_EVENT, { detail: { reason } }));
  } catch {
    /* ignore */
  }
}

export function clearMemoryPressure(): void {
  if (typeof window === "undefined") return;
  lastDispatch = 0;
  try {
    window.dispatchEvent(new CustomEvent(CLEAR_EVENT));
  } catch {
    /* ignore */
  }
}

export function installRuntimePressureListener(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev: ErrorEvent) => {
    const reason = classify(ev.error ?? ev.message);
    if (reason) reportMemoryPressure(reason);
  });
  window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    const reason = classify(ev.reason);
    if (reason) reportMemoryPressure(reason);
  });
}

export const MEMORY_PRESSURE_EVENT = PRESSURE_EVENT;
export const MEMORY_PRESSURE_CLEAR_EVENT = CLEAR_EVENT;
