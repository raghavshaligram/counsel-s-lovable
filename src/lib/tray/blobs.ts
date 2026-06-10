/**
 * Tray blob store — bytes only, keyed by SHA-256.
 * Files never enter React/Zustand state. We pull them in just-in-time
 * before a batch op runs and drop them as soon as the op resolves.
 */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "vaultpdf-tray";
const STORE = "blobs";
const META = "blob-meta";

interface BlobMeta {
  sha256: string;
  size: number;
  lastAccess: number;
}

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      },
    });
  }
  return dbp;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Slice into a plain ArrayBuffer (some bundlers narrow Uint8Array.buffer to SAB)
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const buf = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function putBytes(bytes: Uint8Array): Promise<string> {
  const hash = await sha256Hex(bytes);
  const d = await db();
  const existing = await d.get(STORE, hash);
  if (!existing) await d.put(STORE, bytes, hash);
  await d.put(META, { sha256: hash, size: bytes.byteLength, lastAccess: Date.now() } satisfies BlobMeta, hash);
  return hash;
}

export async function getBytes(hash: string): Promise<Uint8Array | null> {
  const d = await db();
  const v = (await d.get(STORE, hash)) as Uint8Array | undefined;
  if (v) {
    const meta = (await d.get(META, hash)) as BlobMeta | undefined;
    if (meta) await d.put(META, { ...meta, lastAccess: Date.now() }, hash);
    return v;
  }
  return null;
}

export async function deleteBytes(hash: string, refCount: number): Promise<void> {
  // Only delete if no other tray entry references this hash.
  if (refCount > 0) return;
  const d = await db();
  await d.delete(STORE, hash);
  await d.delete(META, hash);
}

export async function evictLRU(budgetBytes: number, keep: Set<string>): Promise<void> {
  const d = await db();
  const metas = (await d.getAll(META)) as BlobMeta[];
  metas.sort((a, b) => b.lastAccess - a.lastAccess);
  let total = 0;
  for (const m of metas) {
    total += m.size;
    if (total > budgetBytes && !keep.has(m.sha256)) {
      await d.delete(STORE, m.sha256);
      await d.delete(META, m.sha256);
    }
  }
}
