// On-device OCR pipeline. Rasterises each page of a PDF via pdf.js, runs
// Tesseract over the image, and rebuilds a new PDF with the original page
// image plus an invisible text layer behind it so the output is
// copy-paste-able and searchable.
//
// All work happens in the browser — no upload.
//
// Performance tactics:
//  - Skip OCR on pages that already have a real text layer (common in
//    "mixed" PDFs). We embed pdf.js's extracted text directly.
//  - Run a pool of Tesseract workers so multiple scanned pages OCR in
//    parallel; rendering pipelines into a free worker as soon as one
//    finishes.
//  - Render at 1.5x (~108 dpi). Tesseract is essentially as accurate on
//    clean prints at this scale and the JPEGs are ~40% smaller.

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFImage } from "pdf-lib";
import { loadPdfjs } from "./worker";

const RENDER_SCALE = 1.5; // ~108 dpi — fine for text OCR, much faster than 2x
const JPEG_QUALITY = 0.78;
const MIN_TEXT_ITEMS_TO_SKIP_OCR = 12; // pages with this many real text items skip OCR

export interface OcrProgress {
  page: number;
  totalPages: number;
  stage: "rendering" | "ocr" | "embedding" | "skipped";
  message: string;
}

interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface PageJob {
  index: number; // 0-based output order
  pageNum: number; // 1-based source page
  words: OcrWord[]; // in canvas-pixel coords at RENDER_SCALE
  jpegBytes: Uint8Array; // page image
  pageWidth: number;
  pageHeight: number;
  skipped: boolean;
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

function drawWordsOnPage(
  outPage: ReturnType<PDFDocument["addPage"]>,
  font: PDFFont,
  img: PDFImage,
  job: PageJob,
) {
  outPage.drawImage(img, { x: 0, y: 0, width: job.pageWidth, height: job.pageHeight });
  const inv = 1 / RENDER_SCALE;
  for (const w of job.words) {
    const text = w.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const wPdf = (w.bbox.x1 - w.bbox.x0) * inv;
    const hPdf = (w.bbox.y1 - w.bbox.y0) * inv;
    if (wPdf <= 0 || hPdf <= 0) continue;
    const fontSize = Math.max(4, hPdf * 0.95);
    const measured = font.widthOfTextAtSize(text, fontSize) || wPdf;
    const sizeAdj =
      measured > 0 ? fontSize * Math.min(1.6, Math.max(0.4, wPdf / measured)) : fontSize;
    outPage.drawText(text, {
      x: w.bbox.x0 * inv,
      y: job.pageHeight - w.bbox.y1 * inv,
      size: sizeAdj,
      font,
      color: rgb(0, 0, 0),
      opacity: 0,
      rotate: degrees(0),
    });
  }
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
  const totalPages = srcDoc.numPages;

  const outPdf = await PDFDocument.create();
  const font = await outPdf.embedFont(StandardFonts.Helvetica);

  // Worker pool — clamp to avoid OOM on huge PDFs / weak machines.
  const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  const poolSize = Math.max(1, Math.min(4, Math.floor(hw / 2)));
  const workers = await Promise.all(
    Array.from({ length: poolSize }, () => tess.createWorker("eng")),
  );
  const idleWorkers = [...workers];
  const waiters: Array<(w: (typeof workers)[number]) => void> = [];
  const acquire = (): Promise<(typeof workers)[number]> =>
    new Promise((res) => {
      const w = idleWorkers.pop();
      if (w) return res(w);
      waiters.push(res);
    });
  const release = (w: (typeof workers)[number]) => {
    const next = waiters.shift();
    if (next) next(w);
    else idleWorkers.push(w);
  };

  let done = 0;
  const reportDone = (pageNum: number, stage: OcrProgress["stage"]) => {
    done++;
    onProgress?.({
      page: done,
      totalPages,
      stage,
      message:
        stage === "skipped"
          ? `Page ${pageNum} already has text — skipped OCR (${done}/${totalPages})`
          : `Processed page ${pageNum} (${done}/${totalPages})`,
    });
  };

  // Kick off one promise per page, but throttled by the worker pool for OCR
  // and by a render concurrency cap so we don't blow memory.
  const RENDER_CONCURRENCY = Math.min(2, poolSize);
  let renderSlots = RENDER_CONCURRENCY;
  const renderWaiters: Array<() => void> = [];
  const acquireRender = () =>
    new Promise<void>((res) => {
      if (renderSlots > 0) {
        renderSlots--;
        res();
      } else renderWaiters.push(res);
    });
  const releaseRender = () => {
    const next = renderWaiters.shift();
    if (next) next();
    else renderSlots++;
  };

  const processPage = async (pageNum: number): Promise<PageJob> => {
    if (signal?.aborted) throw new Error("Cancelled");
    await acquireRender();
    let canvas: HTMLCanvasElement | null = null;
    let words: OcrWord[] = [];
    let skipped = false;
    let pageWidth = 0;
    let pageHeight = 0;
    let jpegBytes: Uint8Array;
    try {
      const page = await srcDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      pageWidth = baseViewport.width;
      pageHeight = baseViewport.height;

      // Fast path: page already has a real text layer.
      const textContent = await page.getTextContent();
      const realItems = (textContent.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>).
        filter((it) => typeof it.str === "string" && it.str.trim().length > 0);

      const viewport = page.getViewport({ scale: RENDER_SCALE });
      canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      jpegBytes = await canvasToJpegBytes(canvas);

      if (realItems.length >= MIN_TEXT_ITEMS_TO_SKIP_OCR) {
        // Convert pdf.js text items → canvas-pixel-space word bboxes so the
        // downstream embed code is unchanged.
        for (const it of realItems) {
          const tx = it.transform ?? [1, 0, 0, 1, 0, 0];
          const fontHeight = Math.hypot(tx[2], tx[3]) || it.height || 10;
          const x0Pdf = tx[4];
          const y0Pdf = tx[5];
          const wPdf = it.width || font.widthOfTextAtSize(it.str || "", fontHeight);
          // pdf.js coords: origin bottom-left in PDF points. Convert to
          // canvas-pixel coords at RENDER_SCALE with origin top-left.
          const x0 = x0Pdf * RENDER_SCALE;
          const x1 = (x0Pdf + wPdf) * RENDER_SCALE;
          const y1 = (pageHeight - y0Pdf) * RENDER_SCALE;
          const y0 = y1 - fontHeight * RENDER_SCALE;
          words.push({ text: it.str || "", bbox: { x0, y0, x1, y1 } });
        }
        skipped = true;
        reportDone(pageNum, "skipped");
      } else {
        // OCR path.
        const worker = await acquire();
        try {
          if (signal?.aborted) throw new Error("Cancelled");
          const { data } = await worker.recognize(canvas, {}, { blocks: true });
          words = collectWords(data);
        } finally {
          release(worker);
        }
        reportDone(pageNum, "ocr");
      }
    } finally {
      releaseRender();
      canvas = null;
    }
    return {
      index: pageNum - 1,
      pageNum,
      words,
      jpegBytes: jpegBytes!,
      pageWidth,
      pageHeight,
      skipped,
    };
  };

  try {
    // Run all pages concurrently — concurrency is bounded internally by
    // the render + OCR semaphores.
    const jobs = await Promise.all(
      Array.from({ length: totalPages }, (_, i) => processPage(i + 1)),
    );
    jobs.sort((a, b) => a.index - b.index);

    for (const job of jobs) {
      if (signal?.aborted) throw new Error("Cancelled");
      const img = await outPdf.embedJpg(job.jpegBytes);
      const outPage = outPdf.addPage([job.pageWidth, job.pageHeight]);
      drawWordsOnPage(outPage, font, img, job);
    }
  } finally {
    await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
  }

  return outPdf.save();
}
