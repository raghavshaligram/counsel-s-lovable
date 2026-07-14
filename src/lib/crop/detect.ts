/**
 * Auto-detect the content bounding box of a PDF page.
 *
 * Renders the page at a moderate scale into an off-screen canvas, then
 * walks the pixel buffer to find the min/max x,y where a pixel is
 * "non-background" (alpha > 0 AND any channel < threshold). Adds a
 * small padding and converts back to PDF user-space points.
 */
import { loadPdfjs } from "@/lib/pdf/worker";
import type { CropRect } from "./types";

export interface DetectOpts {
  /** Render scale. 2.0 is enough for body text; bump to 3 for tiny lines. */
  scale?: number;
  /** RGB channel threshold below which a pixel is "ink". 0–255. */
  inkThreshold?: number;
  /** Padding in points added around the detected bbox. */
  paddingPt?: number;
}

export async function detectContentBounds(
  bytes: Uint8Array,
  pageIndex: number,
  opts: DetectOpts = {},
): Promise<CropRect | null> {
  const scale = opts.scale ?? 2;
  const threshold = opts.inkThreshold ?? 245;
  const padding = opts.paddingPt ?? 6;

  const pdfjs = await loadPdfjs();
  // pdf.js mutates the underlying buffer; pass a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice(), enableXfa: true, useSystemFonts: true }).promise;
  try {
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    // Stride by 2 px for speed; full per-pixel is overkill for bbox.
    const stride = 2;
    for (let y = 0; y < h; y += stride) {
      const rowOff = y * w * 4;
      for (let x = 0; x < w; x += stride) {
        const o = rowOff + x * 4;
        const r = data[o], g = data[o + 1], b = data[o + 2];
        if (r < threshold || g < threshold || b < threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return null; // page is blank

    // Convert from rendered pixel space → PDF user-space points.
    // pdf.js viewport: 1 PDF pt = `scale` pixels. Y flip: PDF origin is bottom-left.
    const pageHeightPx = h;
    const xPt = minX / scale;
    const yPt = (pageHeightPx - maxY) / scale;
    const wPt = (maxX - minX) / scale;
    const hPt = (maxY - minY) / scale;

    return {
      x: Math.max(0, xPt - padding),
      y: Math.max(0, yPt - padding),
      w: wPt + padding * 2,
      h: hPt + padding * 2,
    };
  } finally {
    try { (doc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ }
  }
}
