// Transparent network log: every outbound request to an AI provider is
// recorded locally (URL host, method, model, payload SHA-256, byte counts,
// status, timing). Body hashes only — never raw payloads.
//
// Stored in IndexedDB so it survives reloads, capped to the last 1,000 entries.

const DB_NAME = "vaultpdf-trust";
const STORE = "network-log";
const MAX_ENTRIES = 1000;

export type NetworkLogEntry = {
  id?: number;
  at: number;
  provider: string;
  host: string;
  method: string;
  model?: string;
  bytesOut: number;
  bytesIn: number;
  status: number;
  durationMs: number;
  reqHash: string;
  ok: boolean;
  error?: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;
function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("at", "at");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  let view: Uint8Array;
  if (typeof data === "string") {
    view = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    view = new Uint8Array(data);
  } else {
    view = new Uint8Array(data);
  }
  const out = await crypto.subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(out))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function record(entry: NetworkLogEntry): Promise<void> {
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Trim
    const db2 = await getDb();
    const count = await new Promise<number>((resolve) => {
      const tx = db2.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
    if (count > MAX_ENTRIES) {
      const tx = db2.transaction(STORE, "readwrite");
      const idx = tx.objectStore(STORE).index("at");
      const cursorReq = idx.openCursor();
      let removed = 0;
      const toRemove = count - MAX_ENTRIES;
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur || removed >= toRemove) return;
        cur.delete();
        removed++;
        cur.continue();
      };
    }
  } catch {
    // log shouldn't break the request
  }
}

export async function list(limit = 200): Promise<NetworkLogEntry[]> {
  try {
    const db = await getDb();
    return await new Promise<NetworkLogEntry[]>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const idx = tx.objectStore(STORE).index("at");
      const cursorReq = idx.openCursor(null, "prev");
      const out: NetworkLogEntry[] = [];
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur || out.length >= limit) return resolve(out);
        out.push(cur.value as NetworkLogEntry);
        cur.continue();
      };
      cursorReq.onerror = () => resolve(out);
    });
  } catch {
    return [];
  }
}

export async function clear(): Promise<void> {
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

/**
 * Wrap fetch with logging. Buffers the body to hash it; for SSE/stream
 * responses, byteIn is approximated from the original request only.
 */
export async function loggedFetch(
  provider: string,
  input: RequestInfo | URL,
  init: RequestInit & { model?: string } = {},
): Promise<Response> {
  const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  const method = (init.method ?? "GET").toUpperCase();
  const bodyStr =
    typeof init.body === "string"
      ? init.body
      : init.body instanceof Uint8Array || init.body instanceof ArrayBuffer
        ? "<binary>"
        : init.body
          ? JSON.stringify(init.body)
          : "";
  const reqHash = bodyStr ? await sha256Hex(bodyStr) : "";
  const bytesOut = bodyStr ? new TextEncoder().encode(bodyStr).length : 0;
  const startedAt = performance.now();
  const at = Date.now();
  let host = "";
  try { host = new URL(url, location.origin).host; } catch { /* ignore */ }

  try {
    const res = await fetch(input, init);
    const contentLen = Number(res.headers.get("content-length") ?? "0");
    void record({
      at,
      provider,
      host,
      method,
      model: init.model,
      bytesOut,
      bytesIn: contentLen,
      status: res.status,
      durationMs: Math.round(performance.now() - startedAt),
      reqHash,
      ok: res.ok,
    });
    return res;
  } catch (e) {
    void record({
      at,
      provider,
      host,
      method,
      model: init.model,
      bytesOut,
      bytesIn: 0,
      status: 0,
      durationMs: Math.round(performance.now() - startedAt),
      reqHash,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
