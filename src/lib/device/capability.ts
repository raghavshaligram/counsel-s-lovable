/**
 * Lightweight, one-shot device-capability probe used to size scan
 * estimates and decide whether to show the "slower without GPU"
 * explanatory note. Nothing here is user-facing raw — callers surface a
 * calm tier + a plain-language estimate.
 *
 * Tiers:
 *   - "fast":     WebGPU available AND >= 8 logical cores
 *   - "standard": WebGPU with 4-7 cores, or no WebGPU with >= 8 cores
 *   - "basic":    no WebGPU AND <= 4 cores (or unknown)
 *
 * Per-page timing budgets (ms/page) are conservative post-NER-batching-fix
 * numbers we use for pre-scan estimates and refine mid-scan as real
 * per-page timing arrives.
 */

export type DeviceTier = "fast" | "standard" | "basic";

export type DeviceCapability = {
  tier: DeviceTier;
  cores: number;
  webgpu: boolean;
  /** ms/page for the regex+text pass (no NER). */
  msPerPageRegex: number;
  /** additional ms/page for the NER pass on top of regex. */
  msPerPageNer: number;
};

let cached: DeviceCapability | null = null;
let inflight: Promise<DeviceCapability> | null = null;

async function probeWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export function getDeviceCapability(): Promise<DeviceCapability> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    const cores =
      typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
        ? navigator.hardwareConcurrency
        : 4;
    const webgpu = typeof navigator !== "undefined" ? await probeWebGpu() : false;
    let tier: DeviceTier;
    if (webgpu && cores >= 8) tier = "fast";
    else if ((webgpu && cores >= 4) || (!webgpu && cores >= 8)) tier = "standard";
    else tier = "basic";

    // Empirical per-page budgets after the NER pooling fix.
    // Regex+text pass is CPU-light; NER dominates on CPU (WASM) backends.
    const msPerPageRegex = tier === "fast" ? 8 : tier === "standard" ? 15 : 30;
    const msPerPageNer =
      tier === "fast" ? 25 : tier === "standard" ? 90 : 220;

    cached = { tier, cores, webgpu, msPerPageRegex, msPerPageNer };
    return cached;
  })();
  return inflight;
}

/** Human-readable tier label for optional debug badges. */
export function tierLabel(t: DeviceTier): string {
  return t === "fast" ? "Fast device" : t === "standard" ? "Standard device" : "Basic device";
}

/** Format ms → "~X sec" / "~X min" / "~Xh Ym". */
export function formatEstimate(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 60) return `~${sec} sec`;
  const min = Math.round(sec / 60);
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `~${h}h` : `~${h}h ${rem}m`;
}

/** Rough pre-scan estimate for a document of `pages` pages. */
export function estimateScan(
  cap: DeviceCapability,
  pages: number,
  mode: "quick" | "full",
): number {
  const per = cap.msPerPageRegex + (mode === "full" ? cap.msPerPageNer : 0);
  // Small fixed startup cost (worker spin-up, model load on first full scan).
  const startup = mode === "full" && !cap.webgpu ? 4000 : 1200;
  return startup + pages * per;
}
