/**
 * Pixel-level redaction verification for rasterized (image-only) pages.
 *
 * After the export burns black rectangles into the page bitmap, we
 * re-render each redacted page from the EXPORTED PDF and run OCR
 * (Tesseract.js, on-device) on the area of each redaction rectangle.
 * If any word with non-trivial confidence comes back, the pixels did NOT
 * actually destroy the content and the file must NOT be downloaded.
 *
 * This is the only verification path that proves a scanned-page redaction
 * worked — pdf.js text extraction returns nothing on an image page and
 * therefore can never detect a leak there.
 */
import { loadPdfjs } from "@/lib/pdf/worker";
import { importChunk } from "@/lib/chunk-import";

export interface PixelRedactionRect {
  /** 0-indexed page in the exported PDF. */
  page: number;
  /** Top-left origin rect in PDF points. */
  rect: { x: number; y: number; w: number; h: number };
  label?: string;
}

export interface PixelVerifyResult {
  ok: boolean;
  /** Total rects checked. */
  total: number;
  /** Rects with no recognizable text remaining in pixels. */
  removed: number;
  leaks: Array<{ page: number; rect: { x: number; y: number; w: number; h: number }; text: string; confidence: number }>;
  scannedAt: string;
}

/** Pages NOT in this set are skipped entirely (text-layer pages aren't checked here). */
export async function verifyPixelRedaction(
  bytes: Uint8Array,
  rects: PixelRedactionRect[],
  pagesToCheck: Set<number>,
  options: { scale?: number; minConfidence?: number; minLen?: number } = {},
): Promise<PixelVerifyResult> {
  const scannedAt = new Date().toISOString();
  const targets = rects.filter((r) => pagesToCheck.has(r.page) && r.rect.w > 2 && r.rect.h > 2);
  if (targets.length === 0) {
    return { ok: true, total: 0, removed: 0, leaks: [], scannedAt };
  }

  const scale = options.scale ?? 2.5;
  const minConfidence = options.minConfidence ?? 50;
  const minLen = options.minLen ?? 3;

  const pdfjs = await loadPdfjs();
  const { createWorker } = await importChunk(() => import("tesseract.js"));
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const worker = await createWorker("eng");

  // Bucket rects per page to render each page once.
  const byPage = new Map<number, PixelRedactionRect[]>();
  for (const t of targets) {
    const arr = byPage.get(t.page) ?? [];
    arr.push(t);
    byPage.set(t.page, arr);
  }

  const leaks: PixelVerifyResult["leaks"] = [];
  try {
    for (const [pageIdx, items] of byPage) {
      if (pageIdx < 0 || pageIdx >= doc.numPages) continue;
      const page = await doc.getPage(pageIdx + 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        page.cleanup();
        continue;
      }
      await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
      page.cleanup();

      for (const t of items) {
        // Crop the rect from the rasterized page (PDF points → canvas px = scale).
        const cx = Math.max(0, Math.floor(t.rect.x * scale) - 2);
        const cy = Math.max(0, Math.floor(t.rect.y * scale) - 2);
        const cw = Math.min(canvas.width - cx, Math.ceil(t.rect.w * scale) + 4);
        const ch = Math.min(canvas.height - cy, Math.ceil(t.rect.h * scale) + 4);
        if (cw < 4 || ch < 4) continue;

        const crop = document.createElement("canvas");
        crop.width = cw;
        crop.height = ch;
        const cctx = crop.getContext("2d");
        if (!cctx) continue;
        cctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);

        const { data } = await worker.recognize(crop, {}, { blocks: true });
        const words = collectWords(data);
        const leakWord = words.find((w) => {
          const txt = (w.text ?? "").trim();
          return txt.length >= minLen && (w.confidence ?? 0) >= minConfidence;
        });
        if (leakWord) {
          leaks.push({
            page: pageIdx,
            rect: t.rect,
            text: leakWord.text,
            confidence: leakWord.confidence ?? 0,
          });
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => undefined);
    try { (doc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ }
  }

  return {
    ok: leaks.length === 0,
    total: targets.length,
    removed: targets.length - leaks.length,
    leaks,
    scannedAt,
  };
}

type OcrWord = { text: string; confidence?: number };
function collectWords(data: unknown): OcrWord[] {
  const out: OcrWord[] = [];
  const visit = (node: Record<string, unknown> | null | undefined) => {
    if (!node) return;
    const words = node.words as OcrWord[] | undefined;
    if (Array.isArray(words)) out.push(...words);
    for (const key of ["blocks", "paragraphs", "lines"]) {
      const arr = node[key] as Record<string, unknown>[] | undefined;
      if (Array.isArray(arr)) arr.forEach(visit);
    }
  };
  visit(data as Record<string, unknown>);
  return out;
}
