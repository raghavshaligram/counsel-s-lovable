/**
 * Region-rasterize redaction (bulletproof).
 *
 * For every page that carries one or more redaction rectangles, this module
 * re-renders the page via pdf.js at high resolution, paints solid-black
 * rectangles over each redaction region on the bitmap, and REPLACES that
 * page in the exported PDF with the burned-in image. The text layer for
 * those pages is therefore physically gone — no glyph encoding,
 * CMap or font tricks can recover the underlying content.
 *
 * Two modes:
 *   - "always"   → every page with a redaction is rasterized. Guaranteed safe;
 *                  text on those pages becomes non-selectable.
 *   - "fallback" → only rasterize a page when pdf.js text items actually
 *                  intersect a redaction rect after the prior content-stream
 *                  surgery. Keeps surrounding text selectable when possible.
 */

import { PDFDocument } from "pdf-lib";
import { loadPdfjs } from "@/lib/pdf/worker";

export interface RedactionRectTL {
  /** Top-left origin rect in PDF points (editor convention). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RasterizeMode = "always" | "fallback";

export interface RasterizeOptions {
  scale?: number;
  mode?: RasterizeMode;
}

export interface RasterizeResult {
  bytes: Uint8Array;
  /** Page indices (0-based) that were rasterized. */
  rasterizedPages: number[];
}

export async function rasterizeRedactedPages(
  bytes: Uint8Array,
  pageRedactions: Map<number, RedactionRectTL[]>,
  options: RasterizeOptions = {},
): Promise<RasterizeResult> {
  const scale = options.scale ?? 2.5;
  const mode: RasterizeMode = options.mode ?? "always";
  if (pageRedactions.size === 0) return { bytes, rasterizedPages: [] };

  const pdfjs = await loadPdfjs();
  // pdf.js detaches the buffer it's handed — slice so we keep `bytes` usable.
  const srcDoc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  type Replacement = { pageIdx: number; jpegBytes: Uint8Array };
  const replacements: Replacement[] = [];

  try {
    for (const [pageIdx, rects] of pageRedactions) {
      if (pageIdx < 0 || pageIdx >= srcDoc.numPages) continue;
      if (!rects.length) continue;
      const page = await srcDoc.getPage(pageIdx + 1);
      const viewport1 = page.getViewport({ scale: 1 });
      const pw = viewport1.width;
      const ph = viewport1.height;

      if (mode === "fallback") {
        const tc = await page.getTextContent();
        const hit = tc.items.some((it) => {
          if (!("str" in it)) return false;
          const item = it as { str: string; transform: number[]; width?: number; height?: number };
          if (!item.str || !item.str.trim()) return false;
          const t = item.transform;
          if (!t) return false;
          const fontH = Math.hypot(t[2], t[3]) || item.height || 1;
          // pdf.js user-space → editor top-left.
          const x = t[4];
          const yTop = ph - t[5];
          const w = Math.max(item.width ?? fontH * 0.5, 0.5);
          const itemRect = { x, y: yTop, w, h: fontH };
          return rects.some((r) => rectIntersects(itemRect, r));
        });
        if (!hit) {
          page.cleanup();
          continue;
        }
      }

      // Render page to canvas at scale.
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        page.cleanup();
        throw new Error("Canvas 2D context unavailable");
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // pdfjs render API accepts `canvas` in recent versions; pass both for
      // compatibility.
      const renderTask = page.render({
        canvasContext: ctx,
        viewport: vp,
        canvas,
      } as unknown as Parameters<typeof page.render>[0]);
      await renderTask.promise;

      // Burn black rectangles over each redaction region (editor coords are
      // top-left and match the canvas axis after scaling).
      ctx.fillStyle = "#000000";
      for (const r of rects) {
        ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      }
      page.cleanup();

      const jpegBytes: Uint8Array = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("canvas.toBlob failed"));
            blob
              .arrayBuffer()
              .then((bb) => resolve(new Uint8Array(bb)))
              .catch(reject);
          },
          "image/jpeg",
          0.92,
        );
      });

      replacements.push({ pageIdx, jpegBytes });
      void pw; void ph;
    }
  } finally {
    try { (srcDoc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ }
  }

  if (replacements.length === 0) return { bytes, rasterizedPages: [] };

  // Mutate the exported PDF: replace each affected page with a fresh page of
  // the same size containing only the rasterized bitmap.
  const outDoc = await PDFDocument.load(bytes);
  // Process in descending index order so remove/insert at the same index
  // doesn't shift later targets.
  replacements.sort((a, b) => b.pageIdx - a.pageIdx);
  for (const r of replacements) {
    const pages = outDoc.getPages();
    const existing = pages[r.pageIdx];
    if (!existing) continue;
    const { width, height } = existing.getSize();
    const img = await outDoc.embedJpg(r.jpegBytes);
    outDoc.removePage(r.pageIdx);
    const newPage = outDoc.insertPage(r.pageIdx, [width, height]);
    newPage.drawImage(img, { x: 0, y: 0, width, height });
  }

  const out = await outDoc.save();
  return { bytes: out, rasterizedPages: replacements.map((r) => r.pageIdx).sort((a, b) => a - b) };
}

function rectIntersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
