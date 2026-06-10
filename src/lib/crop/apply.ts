/**
 * Apply a crop rectangle to selected pages in a PDF.
 *
 * pdf-lib exposes `page.setCropBox(x, y, w, h)` in PDF user-space
 * (origin bottom-left, units = points). When `mediaBoxToo` is true we
 * also rewrite `/MediaBox` so viewers without crop support honor the
 * trim. Otherwise we only set `/CropBox` (the safe default; the content
 * stream is untouched and the trim is reversible).
 */
import { PDFDocument } from "pdf-lib";
import type { CropRect, CropScope } from "./types";

export interface ApplyCropOpts {
  /** Either a uniform rect, or one rect per page index. */
  rect: CropRect | Map<number, CropRect>;
  scope: CropScope;
  mediaBoxToo?: boolean;
}

function resolveIndices(scope: CropScope, total: number, current = 0): number[] {
  switch (scope.kind) {
    case "current":   return [current];
    case "all":       return Array.from({ length: total }, (_, i) => i);
    case "odd":       return Array.from({ length: total }, (_, i) => i).filter((i) => (i + 1) % 2 === 1);
    case "even":      return Array.from({ length: total }, (_, i) => i).filter((i) => (i + 1) % 2 === 0);
    case "indices":   return scope.indices.filter((i) => i >= 0 && i < total);
  }
}

export async function applyCrop(
  bytes: Uint8Array,
  opts: ApplyCropOpts,
  currentPageIndex = 0,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const indices = resolveIndices(opts.scope, pages.length, currentPageIndex);
  const isMap = opts.rect instanceof Map;
  for (const i of indices) {
    const page = pages[i];
    const r = isMap ? (opts.rect as Map<number, CropRect>).get(i) : (opts.rect as CropRect);
    if (!r) continue;
    const { width, height } = page.getSize();
    // Clamp to page bounds.
    const x = Math.max(0, Math.min(r.x, width));
    const y = Math.max(0, Math.min(r.y, height));
    const w = Math.max(1, Math.min(r.w, width - x));
    const h = Math.max(1, Math.min(r.h, height - y));
    page.setCropBox(x, y, w, h);
    if (opts.mediaBoxToo) {
      page.setMediaBox(x, y, w, h);
    }
  }
  return doc.save();
}

/** Convenience: build a rect from four margins (in points). */
export function rectFromMargins(
  pageW: number,
  pageH: number,
  margins: [number, number, number, number],
): CropRect {
  const [top, right, bottom, left] = margins;
  return {
    x: left,
    y: bottom,
    w: Math.max(1, pageW - left - right),
    h: Math.max(1, pageH - top - bottom),
  };
}
