/**
 * Request persistent storage from the browser so IndexedDB data isn't
 * evicted under storage pressure. On-device only — no network involved.
 *
 * Browsers default IndexedDB to "best-effort" durability, which means the
 * UA may clear it without warning when disk pressure is high. Calling
 * navigator.storage.persist() upgrades the origin to "persistent" mode
 * (subject to UA heuristics — installed PWA, frequent use, bookmark, etc).
 *
 * Safe to call multiple times; the browser caches the decision.
 */

let attempted = false;

export async function requestPersistentStorage(): Promise<{
  persisted: boolean;
  quota?: number;
  usage?: number;
} | null> {
  if (attempted) return null;
  attempted = true;

  if (typeof navigator === "undefined" || !navigator.storage) {
    console.info("[storage] StorageManager unavailable — skipping persist()");
    return null;
  }

  try {
    const already =
      typeof navigator.storage.persisted === "function"
        ? await navigator.storage.persisted()
        : false;

    let persisted = already;
    if (!already && typeof navigator.storage.persist === "function") {
      persisted = await navigator.storage.persist();
    }

    let quota: number | undefined;
    let usage: number | undefined;
    if (typeof navigator.storage.estimate === "function") {
      try {
        const est = await navigator.storage.estimate();
        quota = est.quota;
        usage = est.usage;
      } catch {
        /* estimate is best-effort */
      }
    }

    const fmt = (n?: number) =>
      typeof n === "number" ? `${(n / 1024 / 1024).toFixed(1)} MB` : "?";
    console.info(
      `[storage] persistent=${persisted} usage=${fmt(usage)} / quota=${fmt(quota)}`,
    );
    if (!persisted) {
      console.warn(
        "[storage] Persistent storage NOT granted — browser may evict IndexedDB under disk pressure.",
      );
    }
    return { persisted, quota, usage };
  } catch (err) {
    console.warn("[storage] persist() failed", err);
    return null;
  }
}
