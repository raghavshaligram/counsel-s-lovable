/**
 * Shared state for the workspace Compare tool. Lets the inspector panel,
 * canvas, and floating toolbar talk to one source of truth without prop
 * drilling. Nothing here leaves the device.
 */
import { create } from "zustand";

export type CompareViewMode = "side" | "diff" | "overlay";

export type CompareBSource =
  | { kind: "none" }
  | { kind: "tab"; tabId: string; name: string; file: File }
  | { kind: "file"; name: string; file: File };

type CompareState = {
  bSource: CompareBSource;
  page: number;
  totalPages: number;
  threshold: number; // pixelmatch threshold
  viewMode: CompareViewMode;
  diffPixels: number | null;
  sizeMatch: boolean;
  busy: boolean;
  exporting: boolean;
  setBSource: (b: CompareBSource) => void;
  setPage: (p: number) => void;
  setTotalPages: (n: number) => void;
  setThreshold: (t: number) => void;
  setViewMode: (m: CompareViewMode) => void;
  setResult: (r: { diffPixels: number | null; sizeMatch: boolean }) => void;
  setBusy: (b: boolean) => void;
  setExporting: (b: boolean) => void;
  reset: () => void;
};

const initial = {
  bSource: { kind: "none" as const },
  page: 1,
  totalPages: 0,
  threshold: 0.1,
  viewMode: "side" as CompareViewMode,
  diffPixels: null,
  sizeMatch: true,
  busy: false,
  exporting: false,
};

export const useCompare = create<CompareState>((set) => ({
  ...initial,
  setBSource: (bSource) => set({ bSource, page: 1, diffPixels: null, totalPages: 0 }),
  setPage: (page) => set({ page: Math.max(1, page) }),
  setTotalPages: (totalPages) => set({ totalPages }),
  setThreshold: (threshold) => set({ threshold }),
  setViewMode: (viewMode) => set({ viewMode }),
  setResult: ({ diffPixels, sizeMatch }) => set({ diffPixels, sizeMatch }),
  setBusy: (busy) => set({ busy }),
  setExporting: (exporting) => set({ exporting }),
  reset: () => set(initial),
}));
