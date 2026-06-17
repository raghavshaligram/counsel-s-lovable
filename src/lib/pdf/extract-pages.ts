// Extract Pages — build a NEW PDF containing only the selected pages.
// Reuses parseRanges from split.ts and pdf-lib's copyPages (same primitive
// used by Split/Organize).

import { PDFDocument } from "pdf-lib";
import { parseRanges, getPageCount } from "./split";

export { parseRanges, getPageCount };

export type ExtractPagesResult = {
  blob: Blob;
  filename: string;
  pageCount: number;
};

/**
 * Extract pages described by a range string ("1-3, 5, 8-10") into a new PDF.
 * Preserves order, deduplicates, ignores encryption.
 */
export async function extractPages(
  file: File,
  ranges: string,
): Promise<ExtractPagesResult> {
  const src = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const total = src.getPageCount();
  const parsed = parseRanges(ranges, total);
  if (parsed.error) throw new Error(parsed.error);
  const seen = new Set<number>();
  const idx: number[] = [];
  for (const g of parsed.groups) {
    for (const p of g) {
      const i = p - 1;
      if (!seen.has(i)) {
        seen.add(i);
        idx.push(i);
      }
    }
  }
  if (idx.length === 0) throw new Error("No pages selected");

  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, idx);
  for (const p of copied) out.addPage(p);
  const bytes = await out.save();
  const base = file.name.replace(/\.pdf$/i, "");
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    filename: `${base}-pages.pdf`,
    pageCount: idx.length,
  };
}
