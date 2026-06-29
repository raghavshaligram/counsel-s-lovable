/**
 * Combine multiple PDFs into one — fully on-device via pdf-lib.
 * Used by the workspace Merge inspector.
 */
import { PDFDocument } from "pdf-lib";

export type MergeItem = {
  file: File;
  /** e.g. "all" | "1-3,5,7-9". Empty / "all" means all pages. */
  range?: string;
};

export type CombineProgress = (done: number, total: number) => void;

/** Read the page count of a PDF without rendering. */
export async function getPageCount(file: File): Promise<number> {
  const buf = await file.arrayBuffer();
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  return doc.getPageCount();
}

/** Parse a 1-indexed range string into a sorted, de-duped array of 0-indexed pages. */
export function parseRange(input: string | undefined, total: number): number[] {
  const trimmed = (input ?? "").trim().toLowerCase();
  if (!trimmed || trimmed === "all" || trimmed === "*") {
    return Array.from({ length: total }, (_, i) => i);
  }
  const out = new Set<number>();
  for (const part of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) {
        if (i >= 1 && i <= total) out.add(i - 1);
      }
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= total) out.add(n - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Combine the items in the given order. Returns a single PDF blob.
 * Nothing is uploaded.
 */
export async function combinePdfs(
  items: MergeItem[],
  onProgress?: CombineProgress,
): Promise<Blob> {
  if (items.length === 0) throw new Error("No files to combine");
  const out = await PDFDocument.create();
  let done = 0;
  for (const item of items) {
    const buf = await item.file.arrayBuffer();
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = parseRange(item.range, src.getPageCount());
    if (pages.length === 0) {
      done += 1;
      onProgress?.(done, items.length);
      continue;
    }
    const copied = await out.copyPages(src, pages);
    for (const p of copied) out.addPage(p);
    done += 1;
    onProgress?.(done, items.length);
  }
  out.setProducer("CounselPDF");
  out.setCreator("CounselPDF");
  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
