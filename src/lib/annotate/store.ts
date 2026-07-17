import { create } from "zustand";
import { openDB, type IDBPDatabase } from "idb";
import type { Annot, AnnotTool, RGB } from "./types";
import { PRESET_COLORS } from "./types";

// IndexedDB autosave keyed by file hash. Uses the `idb` wrapper so transaction
// completion is awaitable (raw IDB returns before tx commits → silent data loss).
const DB_NAME = "counselpdf-annotations";
const STORE = "docs";

let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  if (!dbp) {
    dbp = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
      terminated() {
        console.warn("[annotate] DB connection terminated — reopening");
        dbp = null;
      },
    }).catch((err) => {
      console.error("[annotate] openDB failed", err);
      dbp = null;
      throw err;
    });
  }
  return dbp;
}

export async function loadAnnots(hash: string): Promise<Annot[] | null> {
  const d = db();
  if (!d) return null;
  try {
    const conn = await d;
    const v = (await conn.get(STORE, hash)) as Annot[] | undefined;
    // 'not found / evicted' is normal — return null cleanly.
    return v ?? null;
  } catch (err) {
    console.warn("[annotate] loadAnnots failed", err);
    return null;
  }
}

export async function saveAnnots(hash: string, annots: Annot[]): Promise<boolean> {
  const d = db();
  if (!d) return false;
  try {
    const conn = await d;
    // Await the put — the idb promise resolves on transaction commit, so this
    // confirms the write actually landed.
    await conn.put(STORE, annots, hash);
    return true;
  } catch (err) {
    console.error("[annotate] saveAnnots failed", err);
    return false;
  }
}

export async function clearAnnots(hash: string): Promise<boolean> {
  const d = db();
  if (!d) return false;
  try {
    const conn = await d;
    await conn.delete(STORE, hash);
    return true;
  } catch (err) {
    console.warn("[annotate] clearAnnots failed", err);
    return false;
  }
}

// ----- zustand store -----

const HISTORY_LIMIT = 80;

type State = {
  tool: AnnotTool;
  color: RGB;
  stroke: number;
  fontSize: number;
  opacity: number;
  annots: Annot[];
  selectedId: string | null;
  // history
  past: Annot[][];
  future: Annot[][];
};

type Actions = {
  setTool: (t: AnnotTool) => void;
  setColor: (c: RGB) => void;
  setStroke: (n: number) => void;
  setFontSize: (n: number) => void;
  setOpacity: (n: number) => void;
  select: (id: string | null) => void;
  add: (a: Annot) => void;
  update: (id: string, patch: Partial<Annot>) => void;
  remove: (id: string) => void;
  setAll: (a: Annot[]) => void;
  undo: () => void;
  redo: () => void;
};

export const useAnnotStore = create<State & Actions>((set, get) => ({
  tool: "select",
  color: PRESET_COLORS[0],
  stroke: 2,
  fontSize: 14,
  opacity: 0.45,
  annots: [],
  selectedId: null,
  past: [],
  future: [],

  setTool: (t) => set({ tool: t, selectedId: t === "select" ? get().selectedId : null }),
  setColor: (c) => set({ color: c }),
  setStroke: (n) => set({ stroke: n }),
  setFontSize: (n) => set({ fontSize: n }),
  setOpacity: (n) => set({ opacity: n }),
  select: (id) => set({ selectedId: id }),

  add: (a) => {
    const s = get();
    const past = [...s.past, s.annots].slice(-HISTORY_LIMIT);
    set({ annots: [...s.annots, a], past, future: [], selectedId: a.id });
  },
  update: (id, patch) => {
    const s = get();
    const past = [...s.past, s.annots].slice(-HISTORY_LIMIT);
    set({
      annots: s.annots.map((x) => (x.id === id ? ({ ...x, ...patch } as Annot) : x)),
      past, future: [],
    });
  },
  remove: (id) => {
    const s = get();
    const past = [...s.past, s.annots].slice(-HISTORY_LIMIT);
    set({
      annots: s.annots.filter((x) => x.id !== id),
      past, future: [],
      selectedId: s.selectedId === id ? null : s.selectedId,
    });
  },
  setAll: (a) => set({ annots: a, past: [], future: [], selectedId: null }),
  undo: () => {
    const s = get();
    if (s.past.length === 0) return;
    const prev = s.past[s.past.length - 1];
    set({
      annots: prev,
      past: s.past.slice(0, -1),
      future: [s.annots, ...s.future].slice(0, HISTORY_LIMIT),
      selectedId: null,
    });
  },
  redo: () => {
    const s = get();
    if (s.future.length === 0) return;
    const next = s.future[0];
    set({
      annots: next,
      past: [...s.past, s.annots].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
      selectedId: null,
    });
  },
}));

export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
