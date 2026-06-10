/**
 * Tray store — metadata only. Bytes live in IndexedDB (blobs.ts).
 *
 * Persistence: minimal metadata array is mirrored to localStorage on every
 * mutation so the tray survives a route change / reload. Bytes are
 * fetched on demand via getBytes(entry.sha256).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { putBytes, deleteBytes, getBytes } from "./blobs";
import { PDFDocument } from "pdf-lib";

export interface TrayEntry {
  id: string;          // stable client id (uuid)
  sha256: string;      // content hash — used to fetch bytes
  name: string;
  size: number;        // bytes
  pageCount: number;
  addedAt: number;
  thumb?: string;      // optional data URL for chip preview
}

interface TrayState {
  entries: TrayEntry[];
  selectedId: string | null;
  add: (file: File) => Promise<TrayEntry>;
  addBytes: (name: string, bytes: Uint8Array) => Promise<TrayEntry>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  select: (id: string | null) => void;
  loadBytes: (id: string) => Promise<Uint8Array | null>;
}

function uid() {
  return crypto.randomUUID();
}

async function probePageCount(bytes: Uint8Array): Promise<number> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return 0;
  }
}

export const useTray = create<TrayState>()(
  persist(
    (set, get) => ({
      entries: [],
      selectedId: null,

      async add(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return get().addBytes(file.name, bytes);
      },

      async addBytes(name, bytes) {
        const sha256 = await putBytes(bytes);
        const pageCount = await probePageCount(bytes);
        const entry: TrayEntry = {
          id: uid(),
          sha256,
          name,
          size: bytes.byteLength,
          pageCount,
          addedAt: Date.now(),
        };
        set((s) => ({ entries: [...s.entries, entry], selectedId: s.selectedId ?? entry.id }));
        return entry;
      },

      async remove(id) {
        const entry = get().entries.find((e) => e.id === id);
        if (!entry) return;
        const remaining = get().entries.filter((e) => e.id !== id);
        const refCount = remaining.filter((e) => e.sha256 === entry.sha256).length;
        await deleteBytes(entry.sha256, refCount);
        set({
          entries: remaining,
          selectedId: get().selectedId === id ? (remaining[0]?.id ?? null) : get().selectedId,
        });
      },

      async clear() {
        const all = get().entries;
        const seen = new Set<string>();
        for (const e of all) {
          if (seen.has(e.sha256)) continue;
          seen.add(e.sha256);
          await deleteBytes(e.sha256, 0);
        }
        set({ entries: [], selectedId: null });
      },

      select(id) {
        set({ selectedId: id });
      },

      async loadBytes(id) {
        const entry = get().entries.find((e) => e.id === id);
        if (!entry) return null;
        return getBytes(entry.sha256);
      },
    }),
    {
      name: "vaultpdf.tray.v1",
      storage: createJSONStorage(() => (typeof window === "undefined" ? undefined as never : localStorage)),
      partialize: (s) => ({ entries: s.entries, selectedId: s.selectedId }),
    },
  ),
);
