/**
 * IndexedDB cache for Pre-Discovery embeddings.
 *
 * Key = docKey (name::size::lastModified). Value = { dim, vectors, chunks }.
 * Re-opening the same PDF hydrates the worker from cache in <1s instead
 * of re-embedding every paragraph via MiniLM.
 *
 * Storage is best-effort: quota errors, private mode, and older browsers
 * all no-op silently. The worker still works from scratch when the cache
 * is unavailable.
 */

const DB = "vault.assist.discovery";
const STORE = "indexes";
const VERSION = 1;

export interface CachedIndex {
  dim: number;
  vectors: Float32Array;
  chunks: { id: string; page: number; text: string }[];
  savedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadCachedIndex(docKey: string): Promise<CachedIndex | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<CachedIndex | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(docKey);
      req.onsuccess = () => {
        const val = req.result as CachedIndex | undefined;
        db.close();
        if (!val || typeof val.dim !== "number" || !val.vectors) return resolve(null);
        // Buffers may come back as ArrayBuffer — re-wrap.
        const vectors =
          val.vectors instanceof Float32Array
            ? val.vectors
            : new Float32Array(val.vectors as unknown as ArrayBuffer);
        resolve({ ...val, vectors });
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function saveCachedIndex(
  docKey: string,
  entry: Omit<CachedIndex, "savedAt">,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ...entry, savedAt: Date.now() }, docKey);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function dropCachedIndex(docKey: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(docKey);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
