import { create } from "zustand";
import type { Annot, AnnotTool, RGB } from "./types";
import { PRESET_COLORS } from "./types";

// IndexedDB autosave keyed by file hash
const DB_NAME = "vaultpdf-annotations";
const STORE = "docs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAnnots(hash: string): Promise<Annot[] | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(hash);
      req.onsuccess = () => resolve((req.result as Annot[]) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveAnnots(hash: string, annots: Annot[]) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(annots, hash);
  } catch { /* ignore */ }
}

export async function clearAnnots(hash: string) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(hash);
  } catch { /* ignore */ }
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
