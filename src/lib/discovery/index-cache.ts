/**
 * IndexedDB cache for Pre-Discovery embeddings.
 *
 * Two stores:
 *   • `indexes`       — legacy whole-document blobs (docKey → CachedIndex).
 *   • `chunk_vectors` — per-chunk vectors keyed `${docKey}::${chunkId}`.
 *                       Used by the two-stage search so we only embed
 *                       shortlisted candidates and reuse them next time.
 *
 * Storage is best-effort: quota errors, private mode, and older browsers
 * all no-op silently.
 */

const DB = "vault.assist.discovery";
const INDEX_STORE = "indexes";
const CHUNK_STORE = "chunk_vectors";
const VERSION = 2;

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
        if (!db.objectStoreNames.contains(INDEX_STORE)) db.createObjectStore(INDEX_STORE);
        if (!db.objectStoreNames.contains(CHUNK_STORE)) db.createObjectStore(CHUNK_STORE);
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
      const tx = db.transaction(INDEX_STORE, "readonly");
      const req = tx.objectStore(INDEX_STORE).get(docKey);
      req.onsuccess = () => {
        const val = req.result as CachedIndex | undefined;
        db.close();
        if (!val || typeof val.dim !== "number" || !val.vectors) return resolve(null);
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
      const tx = db.transaction(INDEX_STORE, "readwrite");
      tx.objectStore(INDEX_STORE).put({ ...entry, savedAt: Date.now() }, docKey);
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
      const tx = db.transaction(INDEX_STORE, "readwrite");
      tx.objectStore(INDEX_STORE).delete(docKey);
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

/* ---------------- Per-chunk vector cache (two-stage search) ---------------- */

interface StoredVec {
  dim: number;
  buf: ArrayBuffer;
}

function chunkKey(docKey: string, id: string): string {
  return `${docKey}::${id}`;
}

export async function loadChunkVectors(
  docKey: string,
  ids: string[],
): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  if (ids.length === 0) return out;
  const db = await openDb();
  if (!db) return out;
  return new Promise<Map<string, Float32Array>>((resolve) => {
    try {
      const tx = db.transaction(CHUNK_STORE, "readonly");
      const store = tx.objectStore(CHUNK_STORE);
      let pending = ids.length;
      for (const id of ids) {
        const req = store.get(chunkKey(docKey, id));
        req.onsuccess = () => {
          const val = req.result as StoredVec | undefined;
          if (val && val.buf && typeof val.dim === "number") {
            out.set(id, new Float32Array(val.buf));
          }
          if (--pending === 0) {
            db.close();
            resolve(out);
          }
        };
        req.onerror = () => {
          if (--pending === 0) {
            db.close();
            resolve(out);
          }
        };
      }
    } catch {
      db.close();
      resolve(out);
    }
  });
}

export async function saveChunkVectors(
  docKey: string,
  dim: number,
  entries: Array<{ id: string; vec: Float32Array }>,
): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(CHUNK_STORE, "readwrite");
      const store = tx.objectStore(CHUNK_STORE);
      for (const { id, vec } of entries) {
        // Copy into a plain ArrayBuffer so structured-clone isn't
        // handed a view over a shared buffer.
        const buf = vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength);
        store.put({ dim, buf } as StoredVec, chunkKey(docKey, id));
      }
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
