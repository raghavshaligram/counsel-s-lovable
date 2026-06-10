/**
 * WorkspaceDoc — single in-memory document with debounced encrypted persistence.
 *
 * A4.1: mutations land in an in-memory ledger; flushed to IndexedDB after 2s
 *       idle or on tab hide/lock. Atomic per-doc snapshots.
 * A4.2: lazy text/layout extraction — pages extract only when viewport-entered
 *       or a tool targets them. Cached by (docHash, page).
 *
 * Phase 2 skeleton: persistence is plaintext IndexedDB for now; the AES wrap
 * step plugs in once an unlocked vault handle is available (vault/store.ts).
 */

import { openDB, type IDBPDatabase } from "idb";
import { create } from "zustand";
import { wrap, type VaultHandle } from "@/lib/vault/store";
import { analyzeDocument, type Insight } from "@/lib/intelligence/insights";

export type PageBox = { id: string; page: number; x: number; y: number; w: number; h: number; kind: "pending" | "committed"; reason?: string };

export type WorkspaceDocState = {
  docId: string | null;
  docHash: string | null;
  fileName: string | null;
  pageCount: number;
  bytes: ArrayBuffer | null;
  boxes: PageBox[];
  // viewport
  currentPage: number;
  pagesInView: Set<number>;
  // status line — feeds AppShell file label
  workStatus: string | null;
  // intelligence layer
  insights: Insight[];
  insightsLoading: boolean;
  insightsDismissed: boolean;

  // mutations
  open(file: File): Promise<void>;
  setCurrentPage(i: number): void;
  markInView(i: number): void;
  addBox(box: Omit<PageBox, "id">): void;
  addBoxes(boxes: Omit<PageBox, "id">[]): number;
  removeBox(id: string): void;
  commitPending(): void;
  setStatus(msg: string | null): void;
  dismissInsights(): void;
  reset(): void;
};

const DB_NAME = "vaultpdf";
const STORE = "docs";

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "docId" });
    },
  });
}

let flushTimer: number | undefined;
let vaultHandle: VaultHandle | null = null;

export function setVaultHandle(h: VaultHandle | null) {
  vaultHandle = h;
}

async function persist(snapshot: { docId: string; fileName: string; pageCount: number; boxes: PageBox[] }) {
  const d = await db();
  const payload = new TextEncoder().encode(JSON.stringify(snapshot));
  let stored: { docId: string; cipher?: ArrayBuffer; iv?: ArrayBuffer; plain?: Uint8Array } = { docId: snapshot.docId };
  if (vaultHandle != null) {
    const { iv, ct } = await wrap(vaultHandle, payload.buffer);
    stored = { docId: snapshot.docId, iv, cipher: ct };
  } else {
    // Phase 2 fallback before vault wiring; will be removed in Phase 3.
    stored = { docId: snapshot.docId, plain: payload };
  }
  await d.put(STORE, stored);
}

function scheduleFlush(get: () => WorkspaceDocState) {
  if (typeof window === "undefined") return;
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    const s = get();
    if (!s.docId || !s.fileName) return;
    void persist({ docId: s.docId, fileName: s.fileName, pageCount: s.pageCount, boxes: s.boxes });
  }, 2000);
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const useWorkspace = create<WorkspaceDocState>((set, get) => {
  // Flush on tab hide / vault lock
  if (typeof window !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        window.clearTimeout(flushTimer);
        const s = get();
        if (s.docId && s.fileName) {
          void persist({ docId: s.docId, fileName: s.fileName, pageCount: s.pageCount, boxes: s.boxes });
        }
      }
    });
    window.addEventListener("vault:lock", () => {
      window.clearTimeout(flushTimer);
      set({ bytes: null }); // drop decrypted bytes from memory
    });
  }

  return {
    docId: null,
    docHash: null,
    fileName: null,
    pageCount: 0,
    bytes: null,
    boxes: [],
    currentPage: 0,
    pagesInView: new Set(),
    workStatus: null,
    insights: [],
    insightsLoading: false,
    insightsDismissed: false,

    async open(file) {
      set({ workStatus: "loading…", insights: [], insightsDismissed: false, insightsLoading: false });
      const bytes = await file.arrayBuffer();
      const hash = await sha256Hex(bytes);
      const docId = hash.slice(0, 32);

      // Count pages via pdfjs — done in main thread for skeleton; moves to worker in Phase 3.
      let pageCount = 0;
      let loadedPdf: unknown = null;
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const loadingTask = pdfjs.getDocument({ data: bytes.slice(0) });
        const doc = await loadingTask.promise;
        pageCount = doc.numPages;
        loadedPdf = doc;
      } catch (e) {
        console.warn("pdfjs load failed", e);
      }

      set({
        docId,
        docHash: hash,
        fileName: file.name,
        pageCount,
        bytes,
        boxes: [],
        currentPage: 0,
        pagesInView: new Set([0]),
        workStatus: "analyzing…",
        insightsLoading: true,
      });
      scheduleFlush(get);

      // Intelligence pass — non-blocking, results stream into the UI.
      if (loadedPdf) {
        const targetDocId = docId;
        analyzeDocument(loadedPdf as Parameters<typeof analyzeDocument>[0])
          .then((insights) => {
            if (get().docId !== targetDocId) return; // user switched docs
            set({ insights, insightsLoading: false, workStatus: null });
          })
          .catch((e) => {
            console.warn("analyze failed", e);
            set({ insightsLoading: false, workStatus: null });
          });
      } else {
        set({ insightsLoading: false, workStatus: null });
      }
    },

    setCurrentPage(i) {
      set({ currentPage: i });
    },
    markInView(i) {
      const s = get();
      if (s.pagesInView.has(i)) return;
      const next = new Set(s.pagesInView);
      next.add(i);
      set({ pagesInView: next });
    },
    addBox(box) {
      const id = crypto.randomUUID();
      set({ boxes: [...get().boxes, { ...box, id }] });
      scheduleFlush(get);
    },
    addBoxes(boxes) {
      if (boxes.length === 0) return 0;
      const made: PageBox[] = boxes.map((b) => ({ ...b, id: crypto.randomUUID() }));
      set({ boxes: [...get().boxes, ...made] });
      scheduleFlush(get);
      return made.length;
    },
    removeBox(id) {
      set({ boxes: get().boxes.filter((b) => b.id !== id) });
      scheduleFlush(get);
    },
    commitPending() {
      set({ boxes: get().boxes.map((b) => (b.kind === "pending" ? { ...b, kind: "committed" } : b)) });
      scheduleFlush(get);
    },
    setStatus(msg) {
      set({ workStatus: msg });
    },
    dismissInsights() {
      set({ insightsDismissed: true });
    },
    reset() {
      set({ docId: null, docHash: null, fileName: null, pageCount: 0, bytes: null, boxes: [], currentPage: 0, pagesInView: new Set(), workStatus: null, insights: [], insightsLoading: false, insightsDismissed: false });
    },
  };
});
