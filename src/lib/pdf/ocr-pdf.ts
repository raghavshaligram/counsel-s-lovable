// On-device OCR pipeline. Rasterises each page of a PDF via pdf.js, runs
// Tesseract over the image, and rebuilds a new PDF with the original page
// image plus an invisible text layer behind it so the output is
// copy-paste-able and searchable.
//
// All work happens in the browser — no upload.

import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { loadPdfjs } from "./worker";

const RENDER_SCALE = 2; // ~144 dpi for OCR quality
const JPEG_QUALITY = 0.82;

export interface OcrProgress {
  page: number;
  totalPages: number;
  stage: "rendering" | "ocr" | "embedding";
  message: string;
}

interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

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
  return out.filter((w) => w.text && w.text.trim().length > 0);
}

function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error("canvas.toBlob returned null"));
        const buf = await blob.arrayBuffer();
        resolve(new Uint8Array(buf));
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

export async function ocrPdfToSearchable(
  file: File,
  onProgress?: (p: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const pdfjs = await loadPdfjs();
  const tess = await import("tesseract.js");

  const srcBytes = new Uint8Array(await file.arrayBuffer());
  const srcDoc = await pdfjs.getDocument({ data: srcBytes }).promise;

  const outPdf = await PDFDocument.create();
  const font = await outPdf.embedFont(StandardFonts.Helvetica);

  const worker = await tess.createWorker("eng");

  try {
    for (let p = 1; p <= srcDoc.numPages; p++) {
      if (signal?.aborted) throw new Error("Cancelled");

      onProgress?.({
        page: p,
        totalPages: srcDoc.numPages,
        stage: "rendering",
        message: `Rendering page ${p} of ${srcDoc.numPages}…`,
      });

      const page = await srcDoc.getPage(p);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      onProgress?.({
        page: p,
        totalPages: srcDoc.numPages,
        stage: "ocr",
        message: `Reading text on page ${p} of ${srcDoc.numPages}…`,
      });

      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words = collectWords(data);

      onProgress?.({
        page: p,
        totalPages: srcDoc.numPages,
        stage: "embedding",
        message: `Building searchable page ${p} of ${srcDoc.numPages}…`,
      });

      // Build the output page at the original (unscaled) page size so the
      // resulting PDF preserves dimensions.
      const baseViewport = page.getViewport({ scale: 1 });
      const pageWidth = baseViewport.width;
      const pageHeight = baseViewport.height;

      const jpegBytes = await canvasToJpegBytes(canvas);
      const img = await outPdf.embedJpg(jpegBytes);

      const outPage = outPdf.addPage([pageWidth, pageHeight]);
      outPage.drawImage(img, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });

      // Overlay invisible text positioned at each OCR word's bounding box.
      // Bbox coords are in canvas pixels at RENDER_SCALE — convert to PDF
      // points (1 / RENDER_SCALE) and flip the y-axis (PDF origin is bottom-left).
      const inv = 1 / RENDER_SCALE;
      for (const w of words) {
        const text = w.text.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const wPdf = (w.bbox.x1 - w.bbox.x0) * inv;
        const hPdf = (w.bbox.y1 - w.bbox.y0) * inv;
        if (wPdf <= 0 || hPdf <= 0) continue;

        const fontSize = Math.max(4, hPdf * 0.95);
        const measured = font.widthOfTextAtSize(text, fontSize) || wPdf;
        // Stretch via x-scale (PDF text matrix scaling) by drawing each word
        // with a per-glyph adjusted scale. pdf-lib doesn't expose the text
        // matrix directly, so we approximate by adjusting font size when
        // the natural width vastly differs from the bbox width.
        const sizeAdj = measured > 0 ? fontSize * Math.min(1.6, Math.max(0.4, wPdf / measured)) : fontSize;

        const x = w.bbox.x0 * inv;
        const y = pageHeight - w.bbox.y1 * inv;

        outPage.drawText(text, {
          x,
          y,
          size: sizeAdj,
          font,
          color: rgb(0, 0, 0),
          opacity: 0,
          rotate: degrees(0),
        });
      }
    }
  } finally {
    await worker.terminate();
  }

  return outPdf.save();
}
