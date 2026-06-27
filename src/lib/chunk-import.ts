const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \d+ failed|ChunkLoadError/i;

const RELOAD_KEY = "vaultpdf:chunk-reload-at";

export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return CHUNK_ERROR_RE.test(message);
}

export function reloadForFreshChunks(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? "0");
    const now = Date.now();
    if (Number.isFinite(last) && now - last < 15_000) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // If storage is unavailable, still try a single normal reload.
  }
  window.setTimeout(() => window.location.reload(), 50);
  return true;
}

export async function importChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (isChunkLoadError(err)) {
      if (reloadForFreshChunks()) {
        return new Promise<T>(() => {
          // Keep the caller from showing a tool-level error while the app reloads
          // with the current chunk map.
        });
      }
      throw new Error("This tab is using an old app bundle. Please refresh once and try again.");
    }

    // Non-stale network hiccup: retry once. Browsers cannot retry the exact
    // failed module request, but calling the import expression again handles
    // transient fetch interruptions for still-valid chunks.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 200));
    try {
      return await load();
    } catch (retryErr) {
      if (isChunkLoadError(retryErr)) {
        if (reloadForFreshChunks()) {
          return new Promise<T>(() => {});
        }
        throw new Error("This tab is using an old app bundle. Please refresh once and try again.");
      }
      throw retryErr;
    }
  }
}