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
//  - Worker pool of Tesseract instances so multiple scanned pages OCR in
//    parallel.
//  - Render at 1.5x (~108 dpi). Plenty for OCR on clean prints and ~40%
//    smaller JPEGs than 2x.
//  - Streaming embed: as each page completes OCR we immediately embed it
//    into the output PDF and free the JPEG bytes, instead of holding all
//    400 page images in memory until the end.
//  - OffscreenCanvas when supported so the page render doesn't fight the
//    main thread compositor.

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { loadPdfjs } from "./worker";

const RENDER_SCALE = 1.5;
const JPEG_QUALITY = 0.78;
const MIN_TEXT_ITEMS_TO_SKIP_OCR = 12;

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
  index: number;
  pageNum: number;
  words: OcrWord[];
  jpegBytes: Uint8Array;
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

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      return new OffscreenCanvas(w, h);
    } catch {
      // fall through
    }
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function canvasToJpegBytes(canvas: AnyCanvas): Promise<Uint8Array> {
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      async (blob) => {
        if (!blob) return reject(new Error("canvas.toBlob returned null"));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

function drawWordsOnPage(outPage: PDFPage, font: PDFFont, img: PDFImage, job: PageJob) {
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

  // Render concurrency — keep low so we don't pile up huge canvases.
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

  let completed = 0;
  const report = (pageNum: number, stage: OcrProgress["stage"]) => {
    completed++;
    onProgress?.({
      page: completed,
      totalPages,
      stage,
      message:
        stage === "skipped"
          ? `Page ${pageNum} already had text — skipped OCR (${completed}/${totalPages})`
          : stage === "embedding"
            ? `Embedded page ${pageNum} (${completed}/${totalPages})`
            : `Processed page ${pageNum} (${completed}/${totalPages})`,
    });
  };

  // Streaming embed: pages can finish OCR out of order, but we must add
  // them to the output PDF in order. We maintain a "next index to embed"
  // cursor and a buffer of completed-but-not-yet-embedded jobs.
  const pending = new Map<number, PageJob>();
  let nextToEmbed = 0;
  let embedChain: Promise<void> = Promise.resolve();

  const flushEmbeds = () => {
    embedChain = embedChain.then(async () => {
      while (pending.has(nextToEmbed)) {
        if (signal?.aborted) return;
        const job = pending.get(nextToEmbed)!;
        pending.delete(nextToEmbed);
        const img = await outPdf.embedJpg(job.jpegBytes);
        const outPage = outPdf.addPage([job.pageWidth, job.pageHeight]);
        drawWordsOnPage(outPage, font, img, job);
        // Drop the bytes ASAP so memory doesn't balloon on 400-page jobs.
        (job as { jpegBytes?: Uint8Array }).jpegBytes = undefined;
        nextToEmbed++;
      }
    });
  };

  const processPage = async (pageNum: number): Promise<void> => {
    if (signal?.aborted) throw new Error("Cancelled");
    await acquireRender();
    let words: OcrWord[] = [];
    let skipped = false;
    let pageWidth = 0;
    let pageHeight = 0;
    let jpegBytes: Uint8Array;
    let canvas: AnyCanvas | null = null;
    try {
      const page = await srcDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      pageWidth = baseViewport.width;
      pageHeight = baseViewport.height;

      const textContent = await page.getTextContent();
      const realItems = (
        textContent.items as Array<{
          str?: string;
          transform?: number[];
          width?: number;
          height?: number;
        }>
      ).filter((it) => typeof it.str === "string" && it.str.trim().length > 0);

      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const cw = Math.ceil(viewport.width);
      const ch = Math.ceil(viewport.height);
      canvas = makeCanvas(cw, ch);
      const ctx = canvas.getContext("2d") as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cw, ch);
      await page.render({
        canvasContext: ctx as CanvasRenderingContext2D,
        viewport,
        canvas: canvas as HTMLCanvasElement,
      }).promise;
      jpegBytes = await canvasToJpegBytes(canvas);

      if (realItems.length >= MIN_TEXT_ITEMS_TO_SKIP_OCR) {
        for (const it of realItems) {
          const tx = it.transform ?? [1, 0, 0, 1, 0, 0];
          const fontHeight = Math.hypot(tx[2], tx[3]) || it.height || 10;
          const x0Pdf = tx[4];
          const y0Pdf = tx[5];
          const wPdf = it.width || font.widthOfTextAtSize(it.str || "", fontHeight);
          const x0 = x0Pdf * RENDER_SCALE;
          const x1 = (x0Pdf + wPdf) * RENDER_SCALE;
          const y1 = (pageHeight - y0Pdf) * RENDER_SCALE;
          const y0 = y1 - fontHeight * RENDER_SCALE;
          words.push({ text: it.str || "", bbox: { x0, y0, x1, y1 } });
        }
        skipped = true;
        report(pageNum, "skipped");
      } else {
        const worker = await acquire();
        try {
          if (signal?.aborted) throw new Error("Cancelled");
          const { data } = await worker.recognize(
            canvas as HTMLCanvasElement,
            {},
            { blocks: true },
          );
          words = collectWords(data);
        } finally {
          release(worker);
        }
        report(pageNum, "ocr");
      }
    } finally {
      releaseRender();
      canvas = null;
    }

    pending.set(pageNum - 1, {
      index: pageNum - 1,
      pageNum,
      words,
      jpegBytes: jpegBytes!,
      pageWidth,
      pageHeight,
      skipped,
    });
    flushEmbeds();
  };

  try {
    await Promise.all(Array.from({ length: totalPages }, (_, i) => processPage(i + 1)));
    await embedChain;
  } finally {
    await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
  }

  if (signal?.aborted) throw new Error("Cancelled");
  return outPdf.save();
}
