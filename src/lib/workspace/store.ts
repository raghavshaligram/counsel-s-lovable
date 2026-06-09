// Central workspace store. The file is the noun; every tool reads/writes here.

import { create } from "zustand";
import { toast } from "sonner";
import { PDFDocument } from "pdf-lib";

import {
  clearAllPersistence,
  deleteFileBlob,
  deleteSnapshot,
  gcOrphanBlobs,
  gcSnapshots,
  loadFileBlob,
  loadMeta,
  loadSnapshot,
  saveFileBlob,
  saveMeta,
  saveSnapshot,
  sweepLRU,
  sweepTTL,
} from "./persistence";
import { makeOp, sha256Hex } from "./operations";
import { pdfThumbnail } from "./thumbnail";
import { STORAGE_LIMITS, type OpKind, type Operation, type WorkspaceFile } from "./types";

const SESSION_FLAG = "vaultpdf:persistAcrossSessions";

function newFileId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type Store = {
  files: WorkspaceFile[];
  activeFileId: string | null;
  persistAcrossSessions: boolean;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setPersist: (on: boolean) => Promise<void>;

  addFile: (input: File | Blob, name?: string) => Promise<WorkspaceFile | null>;
  setActive: (id: string | null) => void;
  removeFile: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;

  /** Record an operation; takes a pre-op byte snapshot for undo when feasible. */
  recordOp: (
    fileId: string,
    kind: OpKind,
    preBytes: Uint8Array,
    opts?: { label?: string },
  ) => Promise<Operation | null>;

  /** Replace the bytes of an existing file (e.g. rotate-in-place). */
  replaceFileBytes: (fileId: string, bytes: Uint8Array, name?: string) => Promise<void>;

  /** Add a derived sibling file to the workspace (e.g. split output, merge output). */
  addDerivedFile: (
    parentId: string | null,
    bytes: Uint8Array,
    name: string,
    fromKind: OpKind,
  ) => Promise<WorkspaceFile | null>;

  undoLast: (fileId: string) => Promise<void>;
};

function bytesToBlob(bytes: Uint8Array, type = "application/pdf"): Blob {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Blob([ab], { type });
}

async function pageCountOf(blob: Blob): Promise<number | undefined> {
  try {
    const doc = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return undefined;
  }
}

export const useWorkspace = create<Store>((set, get) => ({
  files: [],
  activeFileId: null,
  persistAcrossSessions: false,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    let persistFlag = false;
    if (typeof localStorage !== "undefined") {
      persistFlag = localStorage.getItem(SESSION_FLAG) === "1";
    }
    if (!persistFlag) {
      set({ hydrated: true, persistAcrossSessions: false });
      return;
    }
    const meta = await loadMeta();
    if (!meta) {
      set({ hydrated: true, persistAcrossSessions: true });
      return;
    }
    const kept = sweepTTL(meta.files as unknown as WorkspaceFile[]);
    const rehydrated: WorkspaceFile[] = [];
    for (const f of kept) {
      const blob = await loadFileBlob(f.id);
      if (blob) rehydrated.push({ ...f, blob });
    }
    const activeId = rehydrated.some((f) => f.id === meta.activeFileId)
      ? meta.activeFileId
      : rehydrated[0]?.id ?? null;
    set({
      files: rehydrated,
      activeFileId: activeId,
      persistAcrossSessions: true,
      hydrated: true,
    });
    // Background GC of orphan blobs/snapshots.
    void gcOrphanBlobs({
      files: rehydrated,
      activeFileId: activeId,
      persistAcrossSessions: true,
      hydrated: true,
    });
    void gcSnapshots({
      files: rehydrated,
      activeFileId: activeId,
      persistAcrossSessions: true,
      hydrated: true,
    });
  },

  setPersist: async (on) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SESSION_FLAG, on ? "1" : "0");
    }
    set({ persistAcrossSessions: on });
    if (on) {
      // Push current files to IDB.
      for (const f of get().files) await saveFileBlob(f.id, f.blob);
      await saveMeta(get());
    } else {
      await clearAllPersistence();
    }
  },

  addFile: async (input, name) => {
    const blob = input instanceof File ? input : new Blob([input], { type: "application/pdf" });
    const fileName = name ?? (input instanceof File ? input.name : "document.pdf");

    const file: WorkspaceFile = {
      id: newFileId(),
      name: fileName,
      blob,
      size: blob.size,
      addedAt: Date.now(),
      lastTouchedAt: Date.now(),
      ops: [makeOp("add", { label: "Added to workspace" })],
    };

    // Best-effort metadata fill (pageCount + thumbnail) — non-blocking for UX.
    file.pageCount = await pageCountOf(blob);
    file.thumbnail = await pdfThumbnail(blob);

    const merged = [...get().files, file];
    const { kept, evicted } = sweepLRU(merged);

    if (evicted.length) {
      toast.info("Optimizing browser memory: clearing oldest file history.");
      if (get().persistAcrossSessions) {
        await Promise.all(evicted.map((e) => deleteFileBlob(e.id)));
      }
    }

    set({ files: kept, activeFileId: file.id });

    if (get().persistAcrossSessions) {
      await saveFileBlob(file.id, blob);
      await saveMeta(get());
    }
    return file;
  },

  setActive: (id) => {
    set({ activeFileId: id });
    if (get().persistAcrossSessions) void saveMeta(get());
  },

  removeFile: async (id) => {
    const next = get().files.filter((f) => f.id !== id);
    const nextActive = get().activeFileId === id ? next[0]?.id ?? null : get().activeFileId;
    set({ files: next, activeFileId: nextActive });
    if (get().persistAcrossSessions) {
      await deleteFileBlob(id);
      // also drop snapshots tied to that file
      const target = get().files.find((f) => f.id === id);
      if (target) {
        for (const op of target.ops) {
          if (op.snapshotKey) await deleteSnapshot(op.snapshotKey);
        }
      }
      await saveMeta(get());
    }
  },

  clearAll: async () => {
    set({ files: [], activeFileId: null });
    await clearAllPersistence();
  },

  recordOp: async (fileId, kind, preBytes, opts) => {
    const file = get().files.find((f) => f.id === fileId);
    if (!file) return null;
    const snapshotKey = await sha256Hex(preBytes);
    let hasSnapshot = false;
    if (get().persistAcrossSessions) {
      try {
        await saveSnapshot(snapshotKey, preBytes);
        hasSnapshot = true;
      } catch {
        hasSnapshot = false;
      }
    }
    const op = makeOp(kind, { label: opts?.label, snapshotKey, hasSnapshot });
    const nextOps = [...file.ops, op].slice(-STORAGE_LIMITS.MAX_OPS_PER_FILE - 1);
    set({
      files: get().files.map((f) =>
        f.id === fileId ? { ...f, ops: nextOps, lastTouchedAt: Date.now() } : f,
      ),
    });
    if (get().persistAcrossSessions) await saveMeta(get());
    return op;
  },

  replaceFileBytes: async (fileId, bytes, name) => {
    const blob = bytesToBlob(bytes);
    const pageCount = await pageCountOf(blob);
    const thumbnail = await pdfThumbnail(blob);
    set({
      files: get().files.map((f) =>
        f.id === fileId
          ? {
              ...f,
              blob,
              size: blob.size,
              pageCount,
              thumbnail,
              name: name ?? f.name,
              lastTouchedAt: Date.now(),
            }
          : f,
      ),
    });
    if (get().persistAcrossSessions) {
      await saveFileBlob(fileId, blob);
      await saveMeta(get());
    }
  },

  addDerivedFile: async (parentId, bytes, name, fromKind) => {
    const blob = bytesToBlob(bytes);
    const file: WorkspaceFile = {
      id: newFileId(),
      name,
      blob,
      size: blob.size,
      addedAt: Date.now(),
      lastTouchedAt: Date.now(),
      pageCount: await pageCountOf(blob),
      thumbnail: await pdfThumbnail(blob),
      ops: [makeOp(fromKind, { label: `Derived from ${fromKind}` })],
    };
    const merged = [...get().files, file];
    const { kept, evicted } = sweepLRU(merged);
    if (evicted.length) {
      toast.info("Optimizing browser memory: clearing oldest file history.");
      if (get().persistAcrossSessions) {
        await Promise.all(evicted.map((e) => deleteFileBlob(e.id)));
      }
    }
    set({ files: kept, activeFileId: file.id });
    if (get().persistAcrossSessions) {
      await saveFileBlob(file.id, blob);
      await saveMeta(get());
    }
    // parentId currently informational — could thread a "derivedFrom" later
    void parentId;
    return file;
  },

  undoLast: async (fileId) => {
    const file = get().files.find((f) => f.id === fileId);
    if (!file) return;
    const last = file.ops[file.ops.length - 1];
    if (!last || !last.hasSnapshot || !last.snapshotKey) {
      toast.error("Nothing to undo for this file.");
      return;
    }
    const bytes = await loadSnapshot(last.snapshotKey);
    if (!bytes) {
      toast.error("Snapshot expired — can't undo.");
      return;
    }
    await get().replaceFileBytes(fileId, bytes);
    set({
      files: get().files.map((f) =>
        f.id === fileId ? { ...f, ops: f.ops.slice(0, -1) } : f,
      ),
    });
    await deleteSnapshot(last.snapshotKey);
    if (get().persistAcrossSessions) await saveMeta(get());
    toast.success(`Undone: ${last.label}`);
  },
}));

export function useActiveFile(): WorkspaceFile | null {
  const id = useWorkspace((s) => s.activeFileId);
  const files = useWorkspace((s) => s.files);
  return files.find((f) => f.id === id) ?? null;
}
