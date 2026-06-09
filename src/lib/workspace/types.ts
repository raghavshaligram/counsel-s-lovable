// Typed shape of the workspace + operations.
// One central type module so every tool agrees.

export type FileId = string;

export type OpKind =
  | "rotate"
  | "split"
  | "merge"
  | "compress"
  | "ocr"
  | "sign"
  | "watermark"
  | "unlock"
  | "protect"
  | "redact"
  | "extract"
  | "to-images"
  | "images-to-pdf"
  | "to-word"
  | "word-to-pdf"
  | "compare"
  | "editor"
  | "chat"
  | "add";

export type Operation = {
  id: string;
  kind: OpKind;
  label: string;
  at: number;
  /** SHA-256 of the file before this op (hex) — also acts as IDB snapshot key. */
  snapshotKey?: string;
  /** Whether a gzipped snapshot of the pre-op bytes exists for undo. */
  hasSnapshot: boolean;
};

export type WorkspaceFile = {
  id: FileId;
  name: string;
  /** Current bytes. Held in memory; persisted only when persistAcrossSessions is on. */
  blob: Blob;
  size: number;
  pageCount?: number;
  /** Data URL of page-1 thumbnail (small, jpeg). */
  thumbnail?: string;
  addedAt: number;
  lastTouchedAt: number;
  ops: Operation[];
};

export type WorkspaceState = {
  files: WorkspaceFile[];
  activeFileId: FileId | null;
  persistAcrossSessions: boolean;
  hydrated: boolean;
};

export const STORAGE_LIMITS = {
  MAX_FILES: 5,
  MAX_TOTAL_BYTES: 150 * 1024 * 1024, // 150MB
  MAX_OPS_PER_FILE: 3,
  TTL_MS: 24 * 60 * 60 * 1000, // 24h
  SNAPSHOT_COMPRESS_THRESHOLD: 1 * 1024 * 1024, // 1MB
} as const;
