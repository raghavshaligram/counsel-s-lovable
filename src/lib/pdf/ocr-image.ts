// On-device OCR for a single image file (JPG / PNG / WebP). Produces a
// one-page searchable PDF with the original image rendered on top and an
// invisible Tesseract text layer underneath. Mirrors the pipeline in
// ocr-pdf.ts but skips all the pdf.js rasterisation since the source is
// already pixels.

import { PDFDocument, rgb, degrees } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";
import { toTesseractLang } from "./ocr-languages";
import { importChunk } from "@/lib/chunk-import";

export interface ImageOcrProgress {
  stage: "loading-language" | "decoding" | "ocr" | "embedding";
  message: string;
}

export interface ImageOcrOptions {
  languages?: string[];
  // Render scale for OCR. 1 = native pixels. Bumped to 1.5 for small images.
  highAccuracy?: boolean;
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

async function decodeImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = url;
    });
  } finally {
    // Revoke after the image has been drawn to canvas downstream.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export async function ocrImageToSearchable(
  file: File,
  onProgress?: (p: ImageOcrProgress) => void,
  signal?: AbortSignal,
  options: ImageOcrOptions = {},
): Promise<Uint8Array> {
  const langs = options.languages && options.languages.length > 0 ? options.languages : ["eng"];
  const langArg = toTesseractLang(langs);
  const tess = await importChunk(() => import("tesseract.js"));

  onProgress?.({
    stage: "decoding",
    message: "Decoding image…",
  });
  const img = await decodeImage(file);
  if (signal?.aborted) throw new Error("Cancelled");

  // Draw to a canvas so Tesseract can chew on pixel data and so we can
  // re-encode to JPEG for embedding (keeps the output PDF small and
  // sidesteps PNG embedding edge cases).
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("Image has zero dimensions");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // White background for transparent PNGs — OCR hates pure transparency.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  onProgress?.({
    stage: "loading-language",
    message:
      langs.length > 1
        ? `Loading language packs (${langs.join(", ")})…`
        : `Loading ${langs[0]} language pack…`,
  });
  const worker = await tess.createWorker(langArg);
  if (signal?.aborted) {
    await worker.terminate().catch(() => undefined);
    throw new Error("Cancelled");
  }

  let words: OcrWord[] = [];
  try {
    onProgress?.({ stage: "ocr", message: "Recognising text…" });
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    words = collectWords(data);
  } finally {
    await worker.terminate().catch(() => undefined);
  }
  if (signal?.aborted) throw new Error("Cancelled");

  onProgress?.({ stage: "embedding", message: "Building searchable PDF…" });
  const jpegBytes: Uint8Array = await new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error("canvas.toBlob returned null"));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      "image/jpeg",
      0.85,
    );
  });

  const out = await PDFDocument.create();
  const font = await embedStandardFont(out, "Helvetica");
  const embedded = await out.embedJpg(jpegBytes);

  // Map pixels to PDF points 1:1 — the resulting page is sized to the
  // image at 72 dpi. Good default; users who need a specific paper size
  // can re-flow downstream.
  const pageWidth = w;
  const pageHeight = h;
  const page = out.addPage([pageWidth, pageHeight]);
  page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });

  for (const word of words) {
    const text = word.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const wPdf = word.bbox.x1 - word.bbox.x0;
    const hPdf = word.bbox.y1 - word.bbox.y0;
    if (wPdf <= 0 || hPdf <= 0) continue;
    const fontSize = Math.max(4, hPdf * 0.95);
    const measured = font.widthOfTextAtSize(text, fontSize) || wPdf;
    const sizeAdj =
      measured > 0 ? fontSize * Math.min(1.6, Math.max(0.4, wPdf / measured)) : fontSize;
    page.drawText(text, {
      x: word.bbox.x0,
      y: pageHeight - word.bbox.y1,
      size: sizeAdj,
      font,
      color: rgb(0, 0, 0),
      opacity: 0,
      rotate: degrees(0),
    });
  }

  return out.save();
}
