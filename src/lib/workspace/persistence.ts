// LRU + TTL persistence on top of idb.ts.
// Stores file Blobs and gzipped pre-op snapshots. Meta lives in a single key.

import { gzipBytes, gunzipBytes } from "./compression";
import {
  idbDel,
  idbGet,
  idbKeys,
  idbSet,
  STORE_FILES,
  STORE_META,
  STORE_SNAPSHOTS,
} from "./idb";
import { STORAGE_LIMITS, type WorkspaceFile, type WorkspaceState } from "./types";

const META_KEY = "workspace-meta";

type PersistedMeta = {
  version: 1;
  persistAcrossSessions: boolean;
  files: Array<Omit<WorkspaceFile, "blob"> & { blobSize: number }>;
  activeFileId: string | null;
  savedAt: number;
};

export async function loadMeta(): Promise<PersistedMeta | null> {
  const m = await idbGet<PersistedMeta>(STORE_META, META_KEY);
  return m ?? null;
}

export async function saveMeta(state: WorkspaceState): Promise<void> {
  const meta: PersistedMeta = {
    version: 1,
    persistAcrossSessions: state.persistAcrossSessions,
    files: state.files.map(({ blob: _blob, ...rest }) => ({ ...rest, blobSize: _blob.size })),
    activeFileId: state.activeFileId,
    savedAt: Date.now(),
  };
  await idbSet(STORE_META, META_KEY, meta);
}

export async function loadFileBlob(id: string): Promise<Blob | undefined> {
  return idbGet<Blob>(STORE_FILES, id);
}

export async function saveFileBlob(id: string, blob: Blob): Promise<void> {
  await idbSet(STORE_FILES, id, blob);
}

export async function deleteFileBlob(id: string): Promise<void> {
  await idbDel(STORE_FILES, id);
}

export async function loadSnapshot(key: string): Promise<Uint8Array | undefined> {
  const v = await idbGet<{ gz: boolean; data: Uint8Array }>(STORE_SNAPSHOTS, key);
  if (!v) return undefined;
  if (v.gz) return await gunzipBytes(v.data);
  return v.data;
}

export async function saveSnapshot(key: string, bytes: Uint8Array): Promise<void> {
  const shouldCompress = bytes.byteLength >= STORAGE_LIMITS.SNAPSHOT_COMPRESS_THRESHOLD;
  const payload = shouldCompress
    ? { gz: true as const, data: await gzipBytes(bytes) }
    : { gz: false as const, data: bytes };
  await idbSet(STORE_SNAPSHOTS, key, payload);
}

export async function deleteSnapshot(key: string): Promise<void> {
  await idbDel(STORE_SNAPSHOTS, key);
}

/** Removes snapshots that no longer correspond to an op anywhere in the workspace. */
export async function gcSnapshots(state: WorkspaceState): Promise<void> {
  const live = new Set<string>();
  for (const f of state.files) {
    for (const op of f.ops) {
      if (op.snapshotKey) live.add(op.snapshotKey);
    }
  }
  const keys = await idbKeys(STORE_SNAPSHOTS);
  await Promise.all(keys.filter((k) => !live.has(k)).map((k) => idbDel(STORE_SNAPSHOTS, k)));
}

/** Removes file blobs whose id is no longer in the workspace. */
export async function gcOrphanBlobs(state: WorkspaceState): Promise<void> {
  const live = new Set(state.files.map((f) => f.id));
  const keys = await idbKeys(STORE_FILES);
  await Promise.all(keys.filter((k) => !live.has(k)).map((k) => idbDel(STORE_FILES, k)));
}

/** Drop entries older than TTL. Returns kept files. */
export function sweepTTL(files: WorkspaceFile[]): WorkspaceFile[] {
  const cutoff = Date.now() - STORAGE_LIMITS.TTL_MS;
  return files.filter((f) => f.lastTouchedAt >= cutoff);
}

/** Enforce 5 files / 150MB cap. LRU by lastTouchedAt. Returns kept files + evicted ids. */
export function sweepLRU(files: WorkspaceFile[]): {
  kept: WorkspaceFile[];
  evicted: WorkspaceFile[];
} {
  const sorted = [...files].sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
  const kept: WorkspaceFile[] = [];
  const evicted: WorkspaceFile[] = [];
  let total = 0;
  for (const f of sorted) {
    const next = total + f.size;
    if (kept.length >= STORAGE_LIMITS.MAX_FILES || next > STORAGE_LIMITS.MAX_TOTAL_BYTES) {
      evicted.push(f);
    } else {
      kept.push(f);
      total = next;
    }
  }
  return { kept, evicted };
}

/** Wipe everything — used by the "Clear workspace" button. */
export async function clearAllPersistence(): Promise<void> {
  const fileKeys = await idbKeys(STORE_FILES);
  const snapKeys = await idbKeys(STORE_SNAPSHOTS);
  await Promise.all([
    ...fileKeys.map((k) => idbDel(STORE_FILES, k)),
    ...snapKeys.map((k) => idbDel(STORE_SNAPSHOTS, k)),
    idbDel(STORE_META, META_KEY),
  ]);
}
