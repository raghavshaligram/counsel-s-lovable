/**
 * Shared UI helpers for AI model downloads.
 *
 * - `notifyModelDownload(name, sizeLabel, run)` wraps a model-load promise
 *   with a sonner toast: shows a spinner while loading, updates with a
 *   percent when `report(progress)` is called, and resolves to a success
 *   toast on completion. If the load completes in < 400ms (fully cached),
 *   the toast is dismissed silently — no spam for warm loads.
 *
 * - `isModelCached(url)` checks Cache Storage for a HuggingFace asset,
 *   used by the offline flow to warn before disconnecting.
 */
import { toast } from "sonner";

export interface ModelDownloadHandle {
  /** Report progress in 0..1 (or 0..100). */
  report(fraction: number): void;
}

export async function notifyModelDownload<T>(
  name: string,
  approxSize: string,
  run: (h: ModelDownloadHandle) => Promise<T>,
): Promise<T> {
  const start = performance.now();
  let toastId: string | number | null = null;
  let lastPct = 0;
  let shown = false;

  const show = () => {
    if (shown) return;
    shown = true;
    toastId = toast.loading(`Setting up ${name}…`, {
      description: `One-time download (~${approxSize}). Cached for next time.`,
      duration: Infinity,
    });
  };

  // Show the toast after 350ms if the load hasn't already finished — this
  // suppresses the toast entirely for already-cached loads.
  const showTimer = window.setTimeout(show, 350);

  const handle: ModelDownloadHandle = {
    report(fraction: number) {
      const pct = Math.max(
        lastPct,
        Math.min(100, Math.round(fraction > 1 ? fraction : fraction * 100)),
      );
      if (pct === lastPct) return;
      lastPct = pct;
      show();
      if (toastId != null) {
        toast.loading(`Downloading ${name} — ${pct}%`, {
          id: toastId,
          description: `~${approxSize} · one-time · cached for next time`,
          duration: Infinity,
        });
      }
    },
  };

  try {
    const result = await run(handle);
    window.clearTimeout(showTimer);
    const elapsed = performance.now() - start;
    if (shown && toastId != null) {
      if (elapsed < 400) {
        toast.dismiss(toastId);
      } else {
        toast.success(`${name} ready`, {
          id: toastId,
          description: "Cached on this device — future runs are instant.",
          duration: 3200,
        });
      }
    }
    return result;
  } catch (err) {
    window.clearTimeout(showTimer);
    if (shown && toastId != null) {
      toast.error(`${name} failed to load`, {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
        duration: 6000,
      });
    }
    throw err;
  }
}

const MINILM_URL =
  "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx";
const NER_URL_PATTERNS = [/bert-base-NER/i];

export interface AiCacheStatus {
  minilmCached: boolean;
  nerCached: boolean;
}

/** Snapshot which large model assets already sit in Cache Storage. */
export async function getAiCacheStatus(): Promise<AiCacheStatus> {
  const out: AiCacheStatus = { minilmCached: false, nerCached: false };
  if (typeof caches === "undefined") return out;
  try {
    const keys = await caches.keys();
    for (const k of keys) {
      const c = await caches.open(k);
      const reqs = await c.keys();
      for (const r of reqs) {
        if (!out.minilmCached && r.url === MINILM_URL) out.minilmCached = true;
        if (!out.nerCached && NER_URL_PATTERNS.some((re) => re.test(r.url)))
          out.nerCached = true;
      }
      if (out.minilmCached && out.nerCached) break;
    }
  } catch {
    /* ignore */
  }
  return out;
}
