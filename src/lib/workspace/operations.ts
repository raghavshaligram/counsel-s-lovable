// Operation log helpers — label formatting + snapshot key derivation.

import type { OpKind, Operation } from "./types";

const LABELS: Record<OpKind, string> = {
  rotate: "Rotated",
  split: "Split",
  merge: "Merged",
  compress: "Compressed",
  ocr: "Made searchable",
  sign: "Signed",
  watermark: "Watermarked",
  unlock: "Unlocked",
  protect: "Password-protected",
  redact: "Redacted",
  extract: "Extracted",
  "to-images": "Converted to images",
  "images-to-pdf": "Built from images",
  "to-word": "Converted to Word",
  "word-to-pdf": "Imported from Word",
  compare: "Compared",
  editor: "Edited",
  chat: "Searched",
  add: "Added to workspace",
};

export function defaultLabel(kind: OpKind, detail?: string): string {
  const base = LABELS[kind] ?? kind;
  return detail ? `${base} · ${detail}` : base;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    // Fallback: timestamp-based key — uniqueness is what matters here.
    return `nohash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", ab);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newOpId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeOp(
  kind: OpKind,
  opts: { label?: string; snapshotKey?: string; hasSnapshot?: boolean } = {},
): Operation {
  return {
    id: newOpId(),
    kind,
    label: opts.label ?? defaultLabel(kind),
    at: Date.now(),
    snapshotKey: opts.snapshotKey,
    hasSnapshot: !!opts.hasSnapshot,
  };
}
