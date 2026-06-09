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
import { toTesseractLang } from "./ocr-languages";

const RENDER_SCALE_DEFAULT = 1.5;
const RENDER_SCALE_HIGH = 2.0;
const JPEG_QUALITY = 0.78;
const MIN_TEXT_ITEMS_TO_SKIP_OCR = 12;

export interface OcrProgress {
  page: number;
  totalPages: number;
  stage: "rendering" | "ocr" | "embedding" | "skipped" | "copied" | "loading-language";
  message: string;
}

export interface OcrOptions {
  // Render canvases at 2x instead of 1.5x. Slower (~80%) but more accurate
  // on small fonts and tight kerning. Default false.
  highAccuracy?: boolean;
  // Tesseract language codes (e.g. ["eng"], ["spa", "eng"]). Defaults to
  // English. Combining languages costs accuracy and memory, so keep the
  // list tight — usually just the document's primary language.
  languages?: string[];
}

interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

// Rasterised page bound for OCR + re-embed. Native pages bypass this
// entirely and are copied through with pdf-lib's copyPages.
interface PageJob {
  kind: "raster";
  index: number;
  pageNum: number;
  words: OcrWord[];
  jpegBytes: Uint8Array;
  pageWidth: number;
  pageHeight: number;
  skipped: boolean;
}

interface CopyJob {
  kind: "copy";
  index: number;
  pageNum: number;
}

type AnyJob = PageJob | CopyJob;

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

function drawWordsOnPage(
  outPage: PDFPage,
  font: PDFFont,
  img: PDFImage,
  job: PageJob,
  renderScale: number,
) {
  outPage.drawImage(img, { x: 0, y: 0, width: job.pageWidth, height: job.pageHeight });
  const inv = 1 / renderScale;
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
  options: OcrOptions = {},
): Promise<Uint8Array> {
  const renderScale = options.highAccuracy ? RENDER_SCALE_HIGH : RENDER_SCALE_DEFAULT;
  const langs = options.languages && options.languages.length > 0 ? options.languages : ["eng"];
  const langArg = toTesseractLang(langs);
  const pdfjs = await loadPdfjs();
  const tess = await import("tesseract.js");

  const srcBytes = new Uint8Array(await file.arrayBuffer());
  const srcDoc = await pdfjs.getDocument({ data: srcBytes }).promise;
  const totalPages = srcDoc.numPages;

  const outPdf = await PDFDocument.create();
  const font = await outPdf.embedFont(StandardFonts.Helvetica);

  // Load the source via pdf-lib once so we can copy native pages through
  // without rasterising them. Lazy: only initialised if we hit a native page.
  let srcPdfLib: PDFDocument | null = null;
  const getSrcPdfLib = async () => {
    if (!srcPdfLib) {
      // pdf-lib mutates the bytes view; pass a fresh copy.
      srcPdfLib = await PDFDocument.load(srcBytes.slice(), { updateMetadata: false });
    }
    return srcPdfLib;
  };

  const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  const poolSize = Math.max(1, Math.min(4, Math.floor(hw / 2)));

  // Surface the (one-time) language-pack download in the progress UI.
  // Tesseract caches the traineddata in IndexedDB so this only takes time
  // on the first run with a given language.
  onProgress?.({
    page: 0,
    totalPages,
    stage: "loading-language",
    message:
      langs.length > 1
        ? `Loading language packs (${langs.join(", ")})…`
        : `Loading ${langs[0]} language pack…`,
  });
  const workers = await Promise.all(
    Array.from({ length: poolSize }, () => tess.createWorker(langArg)),
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
        stage === "copied"
          ? `Page ${pageNum} already searchable — copied through (${completed}/${totalPages})`
          : stage === "skipped"
            ? `Page ${pageNum} already had text — skipped OCR (${completed}/${totalPages})`
            : stage === "embedding"
              ? `Embedded page ${pageNum} (${completed}/${totalPages})`
              : `Processed page ${pageNum} (${completed}/${totalPages})`,
    });
  };

  // Streaming embed: pages can finish out of order, but we must add them to
  // the output PDF in order. A "next index to embed" cursor + buffer keeps
  // page order intact whether the job is a raster OCR result or a
  // copy-through of a native page.
  const pending = new Map<number, AnyJob>();
  let nextToEmbed = 0;
  let embedChain: Promise<void> = Promise.resolve();

  const flushEmbeds = () => {
    embedChain = embedChain.then(async () => {
      while (pending.has(nextToEmbed)) {
        if (signal?.aborted) return;
        const job = pending.get(nextToEmbed)!;
        pending.delete(nextToEmbed);
        if (job.kind === "copy") {
          const src = await getSrcPdfLib();
          const [copied] = await outPdf.copyPages(src, [job.pageNum - 1]);
          outPdf.addPage(copied);
        } else {
          const img = await outPdf.embedJpg(job.jpegBytes);
          const outPage = outPdf.addPage([job.pageWidth, job.pageHeight]);
          drawWordsOnPage(outPage, font, img, job, renderScale);
          // Drop the bytes ASAP so memory doesn't balloon on 400-page jobs.
          (job as { jpegBytes?: Uint8Array }).jpegBytes = undefined;
        }
        nextToEmbed++;
      }
    });
  };

  const processPage = async (pageNum: number): Promise<void> => {
    if (signal?.aborted) throw new Error("Cancelled");

    // Cheap probe FIRST: check for a text layer before doing any raster work.
    // If the page is native (Word-export style), skip the canvas + JPEG +
    // OCR entirely and just copy the original page through. Massive win on
    // mostly-native PDFs.
    const page = await srcDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const realItems = (
      textContent.items as Array<{
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      }>
    ).filter((it) => typeof it.str === "string" && it.str.trim().length > 0);

    if (realItems.length >= MIN_TEXT_ITEMS_TO_SKIP_OCR) {
      pending.set(pageNum - 1, { kind: "copy", index: pageNum - 1, pageNum });
      report(pageNum, "copied");
      flushEmbeds();
      return;
    }

    // Scanned page — needs raster + OCR.
    await acquireRender();
    let words: OcrWord[] = [];
    let jpegBytes: Uint8Array;
    let canvas: AnyCanvas | null = null;
    let pageWidth = 0;
    let pageHeight = 0;
    try {
      const baseViewport = page.getViewport({ scale: 1 });
      pageWidth = baseViewport.width;
      pageHeight = baseViewport.height;

      const viewport = page.getViewport({ scale: renderScale });
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
    } finally {
      releaseRender();
      canvas = null;
    }

    pending.set(pageNum - 1, {
      kind: "raster",
      index: pageNum - 1,
      pageNum,
      words,
      jpegBytes: jpegBytes!,
      pageWidth,
      pageHeight,
      skipped: false,
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
