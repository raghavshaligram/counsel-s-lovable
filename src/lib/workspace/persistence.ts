/**
 * Workspace persistence — IndexedDB only. Nothing leaves the device.
 *
 * Stores:
 *  - ui:    one record at key "ui" with serializable workspace state.
 *  - docs:  recent documents (name, size, addedAt, bytes). Capped by count
 *           and total size; oldest evicted first.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { Anno, OcrPageLayer, PageOp } from "@/lib/editor/types";

const DB_NAME = "counselpdf-workspace";
const UI_STORE = "ui";
const DOC_STORE = "docs";
const SIDECAR_STORE = "sidecars";
const BOOKMARKS_STORE = "bookmarks";

export const MAX_RECENT_COUNT = 10;
export const MAX_RECENT_SIZE = 25 * 1024 * 1024; // 25 MB per doc
export const MAX_TOTAL_SIZE = 120 * 1024 * 1024; // 120 MB total

export function sidecarKey(name: string, size: number) {
  return `${name}::${size}`;
}
function identityKey(name: string, size: number) {
  return sidecarKey(name, size);
}



export type WorkspaceUIState = {
  activeToolId: string | null;
  inspectorOpen: boolean;
  pageLayout: "single" | "double";
  continuous: boolean;
  showGaps: boolean;
  theme: "dark" | "sepia" | "soft" | "white";
  zoom: number;
  zoomMode: "smart" | "fit-width" | "fit-page" | "actual" | "custom";
  licenseKey: string | null;
};

export type RecentDoc = {
  id: string;
  name: string;
  size: number;
  addedAt: number;
  bytes: Uint8Array;
  // On-device OCR memory persisted alongside the file. Mirrors TabState's
  // per-page OCR records so reopening a document keeps its searchable text
  // layer marked as such (tag + editability), never re-OCR'ing pages we've
  // already done. Never uploaded.
  ocrPages?: number[];
  ocrPagesCopied?: number[];
  ocrIsPartial?: boolean;
};

export type RecentMeta = Omit<RecentDoc, "bytes">;


let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbp) {
    dbp = openDB(DB_NAME, 3, {
      upgrade(d, oldVersion) {
        if (!d.objectStoreNames.contains(UI_STORE)) d.createObjectStore(UI_STORE);
        if (!d.objectStoreNames.contains(DOC_STORE)) d.createObjectStore(DOC_STORE);
        if (oldVersion < 2 && !d.objectStoreNames.contains(SIDECAR_STORE)) {
          d.createObjectStore(SIDECAR_STORE);
        }
        if (oldVersion < 3 && !d.objectStoreNames.contains(BOOKMARKS_STORE)) {
          d.createObjectStore(BOOKMARKS_STORE);
        }
      },
      blocked() {
        console.warn("[persistence] DB upgrade blocked by another tab");
      },
      terminated() {
        console.warn("[persistence] DB connection terminated — will reopen");
        dbp = null;
      },
    }).catch((err) => {
      console.error("[persistence] openDB failed", err);
      dbp = null;
      throw err;
    });
  }
  return dbp;
}


/* ----------------------------- UI state ----------------------------- */

export async function loadUIState(): Promise<Partial<WorkspaceUIState> | null> {
  const d = db();
  if (!d) return null;
  try {
    const conn = await d;
    return ((await conn.get(UI_STORE, "state")) as Partial<WorkspaceUIState>) ?? null;
  } catch (err) {
    console.warn("[persistence] loadUIState failed", err);
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingUIState: Partial<WorkspaceUIState> | null = null;
export function saveUIStateDebounced(state: Partial<WorkspaceUIState>) {
  const d = db();
  if (!d) return;
  pendingUIState = state;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const snapshot = pendingUIState;
    pendingUIState = null;
    if (!snapshot) return;
    try {
      const conn = await d;
      // .put() returns a promise that resolves when the transaction commits.
      await conn.put(UI_STORE, snapshot, "state");
    } catch (err) {
      console.error("[persistence] saveUIState failed", err);
    }
  }, 250);
}

/* ----------------------------- Open tabs ---------------------------- */

export type OpenTabMeta = { name: string; size: number };

export async function saveOpenTabs(tabs: OpenTabMeta[]): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    const conn = await d;
    await conn.put(UI_STORE, tabs, "openTabs");
  } catch (err) {
    console.error("[persistence] saveOpenTabs failed", err);
  }
}

export async function loadOpenTabs(): Promise<OpenTabMeta[]> {
  const d = db();
  if (!d) return [];
  try {
    const conn = await d;
    return ((await conn.get(UI_STORE, "openTabs")) as OpenTabMeta[]) ?? [];
  } catch (err) {
    console.warn("[persistence] loadOpenTabs failed", err);
    return [];
  }
}

export async function clearOpenTabs(): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    const conn = await d;
    await conn.delete(UI_STORE, "openTabs");
  } catch (err) {
    console.warn("[persistence] clearOpenTabs failed", err);
  }
}

/* ----------------------------- Recents ----------------------------- */
// PERF: recents metadata is cached in memory after first hydration so the
// rail/empty-state "Resume" lists don't re-scan IndexedDB on every render or
// tab swap. The cache is invalidated on every write (add/remove/clear).
// We also use a single `getAll()` cursor read instead of getAllKeys + N gets,
// which removes per-record transaction overhead (the previous N+1 pattern
// was the main source of perceived lag on the empty workspace screen).

function uid() {
  return crypto.randomUUID();
}

let recentsMetaCache: RecentMeta[] | null = null;
const recentsListeners = new Set<() => void>();
function notifyRecents() {
  for (const l of recentsListeners) l();
}
export function subscribeRecents(l: () => void): () => void {
  recentsListeners.add(l);
  return () => {
    recentsListeners.delete(l);
  };
}
function metaOf(v: RecentDoc): RecentMeta {
  return {
    id: v.id,
    name: v.name,
    size: v.size,
    addedAt: v.addedAt,
    ocrPages: v.ocrPages,
    ocrPagesCopied: v.ocrPagesCopied,
    ocrIsPartial: v.ocrIsPartial,
  };
}

export async function listRecents(): Promise<RecentMeta[]> {
  if (recentsMetaCache) return recentsMetaCache;
  const d = db();
  if (!d) return [];
  try {
    const conn = await d;
    await dedupe(conn);
    // Single cursor read — one transaction, not N. We pay for the bytes
    // once on hydration; subsequent calls return the cached meta array.
    const all = (await conn.getAll(DOC_STORE)) as RecentDoc[];
    const out = all.map(metaOf).sort((a, b) => b.addedAt - a.addedAt);
    recentsMetaCache = out;
    return out;
  } catch (err) {
    console.warn("[persistence] listRecents failed", err);
    return [];
  }
}

/** Synchronous accessor for components that already hydrated. */
export function getCachedRecents(): RecentMeta[] | null {
  return recentsMetaCache;
}

export async function getRecent(id: string): Promise<RecentDoc | null> {
  const d = db();
  if (!d) return null;
  try {
    const conn = await d;
    const rec = (await conn.get(DOC_STORE, id)) as RecentDoc | undefined;
    // 'not found / evicted' is normal — return null cleanly.
    return rec ?? null;
  } catch (err) {
    console.warn("[persistence] getRecent failed", err);
    return null;
  }
}

export type AddRecentOptions = {
  ocrPages?: number[];
  ocrPagesCopied?: number[];
  ocrIsPartial?: boolean;
};

export async function addRecent(
  file: File,
  options: AddRecentOptions = {},
): Promise<RecentMeta | null> {
  const d = db();
  if (!d) return null;
  if (file.size === 0 || file.size > MAX_RECENT_SIZE) return null;
  try {
    const conn = await d;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = identityKey(file.name, file.size);

    // Single getAll() instead of getAllKeys + N gets — same logical work,
    // one transaction.
    const all = (await conn.getAll(DOC_STORE)) as RecentDoc[];
    const allKeys = (await conn.getAllKeys(DOC_STORE)) as string[];
    let reuseId: string | null = null;
    let prevOcrPages: number[] | undefined;
    let prevOcrPagesCopied: number[] | undefined;
    let prevOcrIsPartial: boolean | undefined;
    for (let i = 0; i < all.length; i++) {
      const v = all[i];
      const k = allKeys[i];
      if (!v) continue;
      if (identityKey(v.name, v.size) === key) {
        if (!reuseId) {
          reuseId = v.id;
          prevOcrPages = v.ocrPages;
          prevOcrPagesCopied = v.ocrPagesCopied;
          prevOcrIsPartial = v.ocrIsPartial;
        } else {
          await conn.delete(DOC_STORE, k);
        }
      }
    }

    const id = reuseId ?? uid();
    const rec: RecentDoc = {
      id,
      name: file.name,
      size: file.size,
      addedAt: Date.now(),
      bytes,
      ocrPages: options.ocrPages ?? prevOcrPages,
      ocrPagesCopied: options.ocrPagesCopied ?? prevOcrPagesCopied,
      ocrIsPartial: options.ocrIsPartial ?? prevOcrIsPartial,
    };
    await conn.put(DOC_STORE, rec, id);
    await evict(conn);

    // Refresh the cache from disk so the eviction outcome is reflected
    // exactly. Cheap — we already paid for the read above.
    const fresh = (await conn.getAll(DOC_STORE)) as RecentDoc[];
    recentsMetaCache = fresh.map(metaOf).sort((a, b) => b.addedAt - a.addedAt);
    notifyRecents();
    return metaOf(rec);
  } catch (err) {
    console.error("[persistence] addRecent failed", err);
    return null;
  }
}

export async function removeRecent(id: string): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    const conn = await d;
    await conn.delete(DOC_STORE, id);
    if (recentsMetaCache) {
      recentsMetaCache = recentsMetaCache.filter((r) => r.id !== id);
      notifyRecents();
    }
  } catch (err) {
    console.warn("[persistence] removeRecent failed", err);
  }
}

export async function clearRecents(): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    const conn = await d;
    await conn.clear(DOC_STORE);
    recentsMetaCache = [];
    notifyRecents();
  } catch (err) {
    console.warn("[persistence] clearRecents failed", err);
  }
}

async function evict(conn: IDBPDatabase): Promise<void> {
  // Single getAll(), no N+1.
  const all = (await conn.getAll(DOC_STORE)) as RecentDoc[];
  const allKeys = (await conn.getAllKeys(DOC_STORE)) as string[];
  const metas: Array<RecentMeta & { key: string }> = [];
  for (let i = 0; i < all.length; i++) {
    const v = all[i];
    if (!v) continue;
    metas.push({ id: v.id, name: v.name, size: v.size, addedAt: v.addedAt, key: allKeys[i] });
  }
  // newest first
  metas.sort((a, b) => b.addedAt - a.addedAt);
  const kept: typeof metas = [];
  let total = 0;
  for (const m of metas) {
    if (kept.length >= MAX_RECENT_COUNT) break;
    if (total + m.size > MAX_TOTAL_SIZE) break;
    kept.push(m);
    total += m.size;
  }
  const keepSet = new Set(kept.map((m) => m.key));
  for (const m of metas) {
    if (!keepSet.has(m.key)) await conn.delete(DOC_STORE, m.key);
  }
}

// One-shot dedupe of stored recents: collapse any entries sharing (name+size)
// to a single record — the newest addedAt wins; older duplicates are deleted.
async function dedupe(conn: IDBPDatabase): Promise<void> {
  const keys = (await conn.getAllKeys(DOC_STORE)) as string[];
  const byKey = new Map<string, { key: string; addedAt: number }>();
  const toDelete: string[] = [];
  for (const k of keys) {
    const v = (await conn.get(DOC_STORE, k)) as RecentDoc | undefined;
    if (!v) continue;
    const ident = identityKey(v.name, v.size);
    const prev = byKey.get(ident);
    if (!prev) {
      byKey.set(ident, { key: k, addedAt: v.addedAt });
    } else if (v.addedAt > prev.addedAt) {
      toDelete.push(prev.key);
      byKey.set(ident, { key: k, addedAt: v.addedAt });
    } else {
      toDelete.push(k);
    }
  }
  for (const k of toDelete) await conn.delete(DOC_STORE, k);
}

/* ----------------------------- Sidecars ----------------------------- */
// Per-document sidecar: annotations, page-ops, ocr layer. Keyed by
// `${name}::${size}` so it survives a tab close + re-open. On-device only.

export type SidecarRecord = {
  fileName: string;
  size: number;
  savedAt: number;
  annotations: Anno[];
  pages: PageOp[];
  ocrLayer?: OcrPageLayer[];
};

export async function loadSidecar(name: string, size: number): Promise<SidecarRecord | null> {
  const d = db();
  if (!d) return null;
  try {
    const conn = await d;
    const rec = (await conn.get(SIDECAR_STORE, sidecarKey(name, size))) as
      | SidecarRecord
      | undefined;
    return rec ?? null;
  } catch (err) {
    console.warn("[persistence] loadSidecar failed", err);
    return null;
  }
}

const sidecarTimers = new Map<string, ReturnType<typeof setTimeout>>();
const sidecarPending = new Map<string, Omit<SidecarRecord, "savedAt">>();
export function saveSidecarDebounced(name: string, size: number, rec: Omit<SidecarRecord, "savedAt">) {
  const d = db();
  if (!d) return;
  const key = sidecarKey(name, size);
  sidecarPending.set(key, rec);
  const t = sidecarTimers.get(key);
  if (t) clearTimeout(t);
  sidecarTimers.set(
    key,
    setTimeout(async () => {
      const snapshot = sidecarPending.get(key);
      sidecarPending.delete(key);
      if (!snapshot) return;
      try {
        const conn = await d;
        const full: SidecarRecord = { ...snapshot, savedAt: Date.now() };
        // Await the put — resolves on transaction commit.
        await conn.put(SIDECAR_STORE, full, key);
      } catch (err) {
        console.error("[persistence] saveSidecar failed", err);
      }
    }, 400),
  );
}

// Flush all pending sidecar writes immediately. Call before unload / tab close
// so debounced writes are actually committed.
export async function flushSidecars(): Promise<void> {
  const d = db();
  if (!d) return;
  const pending = Array.from(sidecarPending.entries());
  sidecarPending.clear();
  for (const [, t] of sidecarTimers) clearTimeout(t);
  sidecarTimers.clear();
  if (pending.length === 0) return;
  try {
    const conn = await d;
    await Promise.all(
      pending.map(([key, rec]) =>
        conn.put(SIDECAR_STORE, { ...rec, savedAt: Date.now() } satisfies SidecarRecord, key),
      ),
    );
  } catch (err) {
    console.error("[persistence] flushSidecars failed", err);
  }
}

export async function deleteSidecar(name: string, size: number): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    const conn = await d;
    await conn.delete(SIDECAR_STORE, sidecarKey(name, size));
  } catch (err) {
    console.warn("[persistence] deleteSidecar failed", err);
  }
}

/* ----------------------------- Bookmarks ----------------------------- */
// User-managed bookmarks per document, separate from the PDF's own outline.
// Keyed by `${name}::${size}` — on-device only.

export type UserBookmark = {
  id: string;
  title: string;
  page: number; // 0-based
  createdAt: number;
};

export async function loadBookmarks(name: string, size: number): Promise<UserBookmark[]> {
  const d = db();
  if (!d) return [];
  try {
    const conn = await d;
    const rec = (await conn.get(BOOKMARKS_STORE, sidecarKey(name, size))) as
      | UserBookmark[]
      | undefined;
    return rec ?? [];
  } catch (err) {
    console.warn("[persistence] loadBookmarks failed", err);
    return [];
  }
}

const bmTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bmPending = new Map<string, UserBookmark[]>();
export function saveBookmarksDebounced(name: string, size: number, list: UserBookmark[]) {
  const d = db();
  if (!d) return;
  const key = sidecarKey(name, size);
  bmPending.set(key, list);
  const t = bmTimers.get(key);
  if (t) clearTimeout(t);
  bmTimers.set(
    key,
    setTimeout(async () => {
      const snap = bmPending.get(key);
      bmPending.delete(key);
      if (!snap) return;
      try {
        const conn = await d;
        await conn.put(BOOKMARKS_STORE, snap, key);
      } catch (err) {
        console.error("[persistence] saveBookmarks failed", err);
      }
    }, 300),
  );
}

