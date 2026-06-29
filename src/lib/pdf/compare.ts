import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";
/**
 * Compare — visual diff between two PDFs. Pure on-device: pdf.js renders
 * each page to a canvas, pixelmatch compares the two raster images, and
 * the diff image is composed into a third canvas.
 *
 * This is the SINGLE source of truth for compare logic. Both the workspace
 * Compare panel/canvas and the legacy /compare route call into here.
 */
import { loadPdfjs } from "./worker";
import { importChunk } from "@/lib/chunk-import";

export type ComparePdf = {
  doc: any; // pdfjs PDFDocumentProxy
  pageCount: number;
};

export type CompareRender = {
  width: number;
  height: number;
  /** Number of pixels that differ between A and B. Null when sizes mismatch. */
  diffPixels: number | null;
  /** True when A and B have the same pixel dimensions and were diff'd. */
  sizeMatch: boolean;
  /** True when the requested page exists in BOTH documents. */
  bothExist: boolean;
};

export async function openComparePdf(input: File | Uint8Array | ArrayBuffer): Promise<ComparePdf> {
  const pdfjs = await loadPdfjs();
  let data: ArrayBuffer | Uint8Array;
  if (input instanceof File) data = await input.arrayBuffer();
  else if (input instanceof Uint8Array) data = input;
  else data = input;
  const doc = await pdfjs.getDocument({ data }).promise;
  return { doc, pageCount: doc.numPages };
}

export type RenderPageOptions = {
  pdfA: ComparePdf;
  pdfB: ComparePdf;
  pageIndex: number; // 1-based
  /** Target rendering width in CSS pixels for canvas A. B and diff match. */
  targetWidth: number;
  /** pixelmatch threshold. Lower = stricter (more diffs). 0..1, typically 0.1. */
  threshold: number;
  canvasA: HTMLCanvasElement;
  canvasB: HTMLCanvasElement;
  canvasDiff: HTMLCanvasElement;
};

export async function renderComparePage(opts: RenderPageOptions): Promise<CompareRender> {
  const { pdfA, pdfB, pageIndex, targetWidth, threshold, canvasA, canvasB, canvasDiff } = opts;

  const aDim = await renderTo(pdfA.doc, pageIndex, canvasA, targetWidth);
  const bDim = await renderTo(pdfB.doc, pageIndex, canvasB, aDim?.width ?? targetWidth);

  const bothExist =
    pageIndex >= 1 && pageIndex <= pdfA.pageCount && pageIndex <= pdfB.pageCount;

  if (!aDim || !bDim) {
    drawMessage(canvasDiff, aDim?.width ?? targetWidth, aDim?.height ?? 800, "(no page)");
    return { width: canvasDiff.width, height: canvasDiff.height, diffPixels: null, sizeMatch: false, bothExist };
  }

  if (aDim.width !== bDim.width || aDim.height !== bDim.height) {
    drawMessage(canvasDiff, aDim.width, aDim.height, "Page size differs — visual diff skipped");
    return { width: aDim.width, height: aDim.height, diffPixels: null, sizeMatch: false, bothExist };
  }

  const ctxA = canvasA.getContext("2d")!;
  const ctxB = canvasB.getContext("2d")!;
  const ctxD = canvasDiff.getContext("2d")!;
  canvasDiff.width = aDim.width;
  canvasDiff.height = aDim.height;
  const imgA = ctxA.getImageData(0, 0, aDim.width, aDim.height);
  const imgB = ctxB.getImageData(0, 0, bDim.width, bDim.height);
  const out = ctxD.createImageData(aDim.width, aDim.height);
  const pixelmatch = (await importChunk(() => import("pixelmatch"))).default;
  const diffPixels = pixelmatch(imgA.data, imgB.data, out.data, aDim.width, aDim.height, {
    threshold,
    includeAA: false,
    alpha: 0.4,
    diffColor: [232, 50, 90],
    diffColorAlt: [50, 180, 100],
  });
  ctxD.putImageData(out, 0, 0);
  return { width: aDim.width, height: aDim.height, diffPixels, sizeMatch: true, bothExist };
}

async function renderTo(
  doc: any,
  pageIdx: number,
  canvas: HTMLCanvasElement,
  targetWidth: number,
): Promise<{ width: number; height: number } | null> {
  if (pageIdx < 1 || pageIdx > doc.numPages) {
    canvas.width = targetWidth;
    canvas.height = Math.round(targetWidth * 1.4);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#9ca3af";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("(no page)", canvas.width / 2, canvas.height / 2);
    return null;
  }
  const page = await doc.getPage(pageIdx);
  const baseViewport = page.getViewport({ scale: 1 });
  const useScale = targetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale: useScale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
  return { width: canvas.width, height: canvas.height };
}

function drawMessage(canvas: HTMLCanvasElement, w: number, h: number, msg: string) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff7ed";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#9a3412";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(msg, w / 2, h / 2);
}

/* -------------------------- Export diff PDF -------------------------- */

export type ExportDiffOptions = {
  a: File | Uint8Array;
  b: File | Uint8Array;
  threshold: number;
  /** Image width per rendered page (px). Higher = sharper, larger file. */
  pageWidth?: number;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Build a single PDF where each page is the diff visualization for the
 * corresponding source page (A | B side-by-side stacked above a Diff image).
 * Uses pdf-lib so output is a normal portable PDF. Everything stays local.
 */
export async function exportDiffPdf(opts: ExportDiffOptions): Promise<{ blob: Blob; filename: string; pages: number; changedPages: number }> {
  const pdfA = await openComparePdf(opts.a);
  const pdfB = await openComparePdf(opts.b);
  const pageWidth = opts.pageWidth ?? 1100;
  const total = Math.max(pdfA.pageCount, pdfB.pageCount);

  const { PDFDocument, rgb } = await importChunk(() => import("pdf-lib"));
  const out = await PDFDocument.create();
  const font = await embedStandardFont(out, "Helvetica");
  const fontBold = await embedStandardFont(out, "HelveticaBold");

  // Offscreen canvases reused per page.
  const cA = document.createElement("canvas");
  const cB = document.createElement("canvas");
  const cD = document.createElement("canvas");

  let changedPages = 0;

  for (let i = 1; i <= total; i++) {
    const r = await renderComparePage({
      pdfA,
      pdfB,
      pageIndex: i,
      targetWidth: pageWidth,
      threshold: opts.threshold,
      canvasA: cA,
      canvasB: cB,
      canvasDiff: cD,
    });
    if ((r.diffPixels ?? 0) > 0 || !r.sizeMatch) changedPages++;

    // Build a single PDF page that stacks: Header / A | B (side by side) / Diff.
    const pngA = canvasToBytes(cA);
    const pngB = canvasToBytes(cB);
    const pngD = canvasToBytes(cD);
    const [imgA, imgB, imgD] = await Promise.all([
      out.embedPng(await pngA),
      out.embedPng(await pngB),
      out.embedPng(await pngD),
    ]);

    const margin = 24;
    const gap = 12;
    const headerH = 28;
    const sideW = Math.min(imgA.width, imgB.width);
    const sideScale = ((pageWidth - gap) / 2) / sideW;
    const sideRenderW = sideW * sideScale;
    const sideRenderH = Math.max(imgA.height, imgB.height) * sideScale;
    const diffRenderW = pageWidth;
    const diffRenderH = imgD.height * (pageWidth / imgD.width);

    const pageW = pageWidth + margin * 2;
    const pageH = headerH + sideRenderH + gap + diffRenderH + margin * 2;
    const page = out.addPage([pageW, pageH]);

    const changed = r.diffPixels ?? 0;
    page.drawText(`Page ${i} — ${r.sizeMatch ? `${changed.toLocaleString()} px changed` : "size mismatch"}`, {
      x: margin,
      y: pageH - margin - 14,
      size: 11,
      font: fontBold,
      color: rgb(0.13, 0.14, 0.17),
    });

    // Side by side
    const sideY = pageH - margin - headerH - sideRenderH;
    page.drawImage(imgA, { x: margin, y: sideY, width: sideRenderW, height: imgA.height * sideScale });
    page.drawImage(imgB, {
      x: margin + sideRenderW + gap,
      y: sideY,
      width: sideRenderW,
      height: imgB.height * sideScale,
    });
    page.drawText("A", { x: margin + 4, y: sideY + imgA.height * sideScale - 12, size: 9, font, color: rgb(0.55, 0.35, 0.05) });
    page.drawText("B", { x: margin + sideRenderW + gap + 4, y: sideY + imgB.height * sideScale - 12, size: 9, font, color: rgb(0.55, 0.35, 0.05) });

    // Diff below
    const diffY = sideY - gap - diffRenderH;
    page.drawImage(imgD, { x: margin, y: diffY, width: diffRenderW, height: diffRenderH });

    opts.onProgress?.(i, total);
  }

  const bytes = await out.save();
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const filename = `counselpdf-diff-${Date.now()}.pdf`;
  return { blob, filename, pages: total, changedPages };
}

function canvasToBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    c.toBlob(async (blob) => {
      if (!blob) return reject(new Error("canvas.toBlob failed"));
      const buf = await blob.arrayBuffer();
      resolve(new Uint8Array(buf));
    }, "image/png");
  });
}
