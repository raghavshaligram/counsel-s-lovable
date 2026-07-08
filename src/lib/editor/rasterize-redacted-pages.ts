/**
 * Region-rasterize redaction (bulletproof, streaming).
 *
 * For every page that carries one or more redaction rectangles, this module
 * re-renders the page via pdf.js at high resolution, paints solid-black
 * rectangles over each redaction region on the bitmap, and REPLACES that
 * page in the exported PDF with the burned-in image. The text layer for
 * those pages is therefore physically gone — no glyph encoding,
 * CMap or font tricks can recover the underlying content.
 *
 * MEMORY MODEL: pages are processed one-at-a-time. Canvas + JPEG bytes are
 * freed BEFORE moving to the next page. Peak memory === one page's canvas
 * plus one JPEG, regardless of document size. This is the fix for the
 * 3000-page redaction crash — previously all N JPEGs accumulated in RAM.
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
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface RasterizeResult {
  bytes: Uint8Array;
  /** Page indices (0-based) that were rasterized. FULLY rasterized only —
   *  a downstream raw-stream verifier can safely skip these pages. */
  rasterizedPages: number[];
}

export async function rasterizeRedactedPages(
  bytes: Uint8Array,
  pageRedactions: Map<number, RedactionRectTL[]>,
  options: RasterizeOptions = {},
): Promise<RasterizeResult> {
  const scale = options.scale ?? 2.5;
  const mode: RasterizeMode = options.mode ?? "always";
  const signal = options.signal;
  const onProgress = options.onProgress;
  if (pageRedactions.size === 0) return { bytes, rasterizedPages: [] };

  // Load the output doc ONCE up front so we can stream embeds page-by-page
  // instead of accumulating every JPEG in a replacements[] array.
  const outDoc = await PDFDocument.load(bytes);
  const pdfjs = await loadPdfjs();
  // In max-security mode, pdf-lib has already parsed the source and the raw
  // buffer can be handed to pdf.js without keeping a second full-file slice.
  // Fallback mode may need to return the original bytes unchanged, so preserve
  // its buffer there only.
  const srcData = mode === "fallback" ? bytes.slice() : bytes;
  const srcDoc = await pdfjs.getDocument({ data: srcData }).promise;
  const rasterizedPages: number[] = [];

  // Sort keys descending — removePage(i)+insertPage(i) keeps ordering but
  // processing high→low means we never touch a page after mutation.
  const pageOrder = Array.from(pageRedactions.keys()).sort((a, b) => b - a);

  let done = 0;
  const total = pageOrder.length;

  try {
    for (const pageIdx of pageOrder) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const rects = pageRedactions.get(pageIdx);
      if (!rects || !rects.length) continue;
      if (pageIdx < 0 || pageIdx >= srcDoc.numPages) continue;

      const page = await srcDoc.getPage(pageIdx + 1);
      const viewport1 = page.getViewport({ scale: 1 });
      const pw = viewport1.width;
      const ph = viewport1.height;

      if (mode === "fallback") {
        const tc = await page.getTextContent();
        const hit = tc.items.some((it: unknown) => {
          if (!("str" in it)) return false;
          const item = it as { str: string; transform: number[]; width?: number; height?: number };
          if (!item.str || !item.str.trim()) return false;
          const t = item.transform;
          if (!t) return false;
          const fontH = Math.hypot(t[2], t[3]) || item.height || 1;
          const x = t[4];
          const yTop = ph - t[5];
          const w = Math.max(item.width ?? fontH * 0.5, 0.5);
          const itemRect = { x, y: yTop, w, h: fontH };
          return rects.some((r) => rectIntersects(itemRect, r));
        });
        if (!hit) {
          try { (page as unknown as { cleanup?: () => void }).cleanup?.(); } catch { /* ignore */ }
          done++;
          onProgress?.(done, total);
          continue;
        }
      }

      // Render page to canvas at scale.
      const vp = page.getViewport({ scale });
      let canvas: HTMLCanvasElement | null = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        try { (page as unknown as { cleanup?: () => void }).cleanup?.(); } catch { /* ignore */ }
        throw new Error("Canvas 2D context unavailable");
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport: vp,
        canvas,
      } as unknown as Parameters<typeof page.render>[0]);
      await renderTask.promise;

      ctx.fillStyle = "#000000";
      // Paint a small bleed (~2px at render scale) beyond the exact rect
      // bounds. JPEG's 8x8 DCT introduces ringing/blur at high-contrast
      // edges; bleeding the black fill outward guarantees the intended
      // redaction area remains solidly black after JPEG encoding. Bleeding
      // outward is always safe — a black margin never reveals content.
      const BLEED = 2;
      for (const r of rects) {
        const x = r.x * scale - BLEED;
        const y = r.y * scale - BLEED;
        const w = r.w * scale + BLEED * 2;
        const h = r.h * scale + BLEED * 2;
        ctx.fillRect(x, y, w, h);
      }
      try { (page as unknown as { cleanup?: () => void }).cleanup?.(); } catch { /* ignore */ }

      let jpegBytes: Uint8Array | null = await new Promise<Uint8Array>((resolve, reject) => {
        canvas!.toBlob(
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

      // Free the canvas bitmap NOW — peak memory === 1 canvas + 1 JPEG.
      canvas.width = 0;
      canvas.height = 0;
      canvas = null;

      // Stream the embed: remove old page, insert a new one, draw the JPEG,
      // and drop the JPEG bytes before moving on.
      const pages = outDoc.getPages();
      const existing = pages[pageIdx];
      if (existing) {
        const { width, height } = existing.getSize();
        const img = await outDoc.embedJpg(jpegBytes);
        outDoc.removePage(pageIdx);
        const newPage = outDoc.insertPage(pageIdx, [width, height]);
        newPage.drawImage(img, { x: 0, y: 0, width, height });
        rasterizedPages.push(pageIdx);
      }
      jpegBytes = null;
      void pw; void ph;

      done++;
      onProgress?.(done, total);

      // Yield to the event loop every page so the main thread can paint
      // and process user input (progress toasts, cancel button).
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  } finally {
    try { (srcDoc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ }
  }

  if (rasterizedPages.length === 0) return { bytes, rasterizedPages: [] };

  const out = await outDoc.save();
  return { bytes: out, rasterizedPages: rasterizedPages.slice().sort((a, b) => a - b) };
}

function rectIntersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
