/**
 * Organize session store — shared between the canvas grid and the
 * inspector panel so a single inspector can drive a canvas surface
 * (Option-A, per project Constitution: one canvas, one inspector).
 *
 * Cells, selection, and source registry live here. Bytes for the active
 * tab's file are provided to `seedFromActiveFile`; tray entries are
 * fetched on demand via `addTrayEntry`.
 */
import { create } from "zustand";
import type { PageCell, OrganizeSource, Rotation } from "@/lib/pdf/organize";
import { ORGANIZE_PALETTE } from "@/lib/pdf/organize";
import { PDFDocument } from "pdf-lib";
import { getBytes } from "@/lib/tray/blobs";
import { useTray } from "@/lib/tray/store";

interface OrganizeState {
  sources: Record<string, OrganizeSource & { colorIdx: number }>;
  cells: PageCell[];
  selected: Set<string>;
  dragId: string | null;
  seededFor: string | null;

  /** Imperative scroll-to-index signal for the grid surface. */
  jumpIdx: number | null;
  jumpTick: number;

  /** Grid density 0..1 — 0 = largest tiles (fewest cols), 1 = smallest. */
  density: number;
  setDensity: (d: number) => void;


  seedFromActiveFile: (tabId: string, file: File) => Promise<void>;
  addTrayEntry: (entryId: string) => Promise<void>;
  reset: () => void;

  toggleSelect: (cellId: string, shift: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  /** Select the inclusive 0-based index range [start..end] (clamped). */
  selectRange: (start: number, end: number, additive?: boolean) => void;
  rotateSelected: () => void;
  deleteSelected: () => void;

  setDragId: (id: string | null) => void;
  reorderOver: (overId: string) => void;
  moveTo: (targetCellId: string, side: "before" | "after") => void;
  setThumb: (cellId: string, thumb: string) => void;

  /** Request the grid surface scroll to a given 0-based cell index. */
  requestJump: (idx: number) => void;

  colorFor: (sourceKey: string) => string;
  resolveBytes: (sourceKey: string) => Promise<Uint8Array | null>;
}

let nonce = 0;
const cellId = (src: string, page: number) => `${src}-${page}@${nonce++}`;

export const useOrganize = create<OrganizeState>((set, get) => ({
  sources: {},
  cells: [],
  selected: new Set(),
  dragId: null,
  seededFor: null,
  jumpIdx: null,
  jumpTick: 0,
  density: 0.5,
  setDensity(d) {
    set({ density: Math.max(0, Math.min(1, d)) });
  },


  async seedFromActiveFile(tabId, file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    const key = "active";
    const cells: PageCell[] = [];
    for (let i = 0; i < pageCount; i++) {
      cells.push({
        cellId: cellId(key, i),
        source: key,
        fileName: file.name,
        pageIndex: i,
        rotation: 0,
      });
    }
    set({
      sources: { [key]: { bytes, fileName: file.name, pageCount, colorIdx: 0 } },
      cells,
      selected: new Set(),
      dragId: null,
      seededFor: tabId,
    });
  },

  async addTrayEntry(entryId) {
    const entry = useTray.getState().entries.find((e) => e.id === entryId);
    if (!entry) return;
    const existing = get().sources[entryId];
    let src = existing;
    if (!src) {
      const bytes = await getBytes(entry.sha256);
      if (!bytes) return;
      const colorIdx = Object.keys(get().sources).length;
      src = { bytes, fileName: entry.name, pageCount: entry.pageCount, colorIdx };
    }
    const additions: PageCell[] = [];
    for (let i = 0; i < src.pageCount; i++) {
      additions.push({
        cellId: cellId(entryId, i),
        source: entryId,
        fileName: src.fileName,
        pageIndex: i,
        rotation: 0,
      });
    }
    set((s) => ({
      sources: { ...s.sources, [entryId]: src },
      cells: [...s.cells, ...additions],
    }));
  },

  reset() {
    set({ sources: {}, cells: [], selected: new Set(), dragId: null, seededFor: null });
  },

  toggleSelect(id, shift) {
    set((s) => {
      const next = new Set(s.selected);
      if (shift && s.cells.length) {
        const idxs = Array.from(next).map((x) => s.cells.findIndex((c) => c.cellId === x));
        const last = idxs.length ? Math.max(...idxs) : 0;
        const cur = s.cells.findIndex((c) => c.cellId === id);
        const [a, b] = [Math.min(last, cur), Math.max(last, cur)];
        for (let i = a; i <= b; i++) next.add(s.cells[i].cellId);
        return { selected: next };
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    });
  },

  selectAll() {
    set((s) => ({ selected: new Set(s.cells.map((c) => c.cellId)) }));
  },
  clearSelection() {
    set({ selected: new Set() });
  },

  selectRange(start, end, additive = false) {
    set((s) => {
      if (s.cells.length === 0) return { selected: s.selected };
      const a = Math.max(0, Math.min(start, end));
      const b = Math.min(s.cells.length - 1, Math.max(start, end));
      const next = additive ? new Set(s.selected) : new Set<string>();
      for (let i = a; i <= b; i++) next.add(s.cells[i].cellId);
      return { selected: next };
    });
  },

  requestJump(idx) {
    set((s) => ({ jumpIdx: idx, jumpTick: s.jumpTick + 1 }));
  },

  rotateSelected() {
    set((s) => ({
      cells: s.cells.map((c) =>
        s.selected.has(c.cellId)
          ? { ...c, rotation: (((c.rotation + 90) % 360) as Rotation) }
          : c,
      ),
    }));
  },

  deleteSelected() {
    set((s) => ({
      cells: s.cells.filter((c) => !s.selected.has(c.cellId)),
      selected: new Set(),
    }));
  },

  setDragId(id) {
    set({ dragId: id });
  },

  reorderOver(overId) {
    const { dragId, cells } = get();
    if (!dragId || dragId === overId) return;
    const from = cells.findIndex((c) => c.cellId === dragId);
    const to = cells.findIndex((c) => c.cellId === overId);
    if (from < 0 || to < 0) return;
    const next = cells.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set({ cells: next });
  },

  /** Drop the currently-dragged cell BEFORE or AFTER `targetCellId`. */
  moveTo(targetCellId, side) {
    const { dragId, cells } = get();
    if (!dragId) return;
    const from = cells.findIndex((c) => c.cellId === dragId);
    if (from < 0) return;
    const next = cells.slice();
    const [moved] = next.splice(from, 1);
    // Recompute target index AFTER removal so before/after stays correct.
    let toIdx = next.findIndex((c) => c.cellId === targetCellId);
    if (toIdx < 0) toIdx = next.length;
    if (side === "after") toIdx += 1;
    next.splice(toIdx, 0, moved);
    set({ cells: next, dragId: null });
  },

  setThumb(id, thumb) {
    set((s) => ({ cells: s.cells.map((c) => (c.cellId === id ? { ...c, thumb } : c)) }));
  },

  colorFor(sourceKey) {
    const src = get().sources[sourceKey];
    const idx = src ? src.colorIdx : 0;
    return ORGANIZE_PALETTE[idx % ORGANIZE_PALETTE.length];
  },

  async resolveBytes(sourceKey) {
    return get().sources[sourceKey]?.bytes ?? null;
  },
}));
