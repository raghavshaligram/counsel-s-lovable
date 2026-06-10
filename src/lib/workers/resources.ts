/**
 * Resource probe — D-section sizing.
 *
 * Worker pool sized via navigator.hardwareConcurrency.
 * Chunk + cache budgets scale by navigator.deviceMemory.
 * Conservative mode triggers at deviceMemory <= 4 (locked decision).
 */

export type ResourceTier = "conservative" | "balanced" | "aggressive";

export function detectResources() {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  const memory =
    typeof navigator !== "undefined" && "deviceMemory" in navigator
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
      : 4;

  let tier: ResourceTier;
  if (memory <= 4) tier = "conservative";
  else if (memory >= 8) tier = "aggressive";
  else tier = "balanced";

  return {
    cores,
    memory,
    tier,
    workerPoolSize:
      tier === "conservative" ? Math.max(1, Math.min(2, cores - 1)) :
      tier === "aggressive" ? Math.max(2, cores - 1) :
      Math.max(2, Math.floor(cores / 2)),
    chunkPages: tier === "conservative" ? 5 : tier === "aggressive" ? 20 : 10,
    cacheBudgetMB: tier === "conservative" ? 128 : tier === "aggressive" ? 1024 : 384,
  };
}
