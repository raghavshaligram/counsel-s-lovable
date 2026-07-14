// Text watermark — on-device, fully in browser.
//
// The stamp is rendered into a Form XObject and referenced with `Do` on every
// page. That's the same shape the "Remove Watermark" tool detects — so any
// watermark we apply here can be losslessly removed later. The XObject is
// tagged with a custom `/CounselPDFWatermark` marker so the remover picks it
// up on documents with any page count (the general repeated-XObject
// heuristic needs ≥2 pages; the marker bypasses that entirely).

import { PDFDocument, PDFName, PDFRawStream, degrees, rgb } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";
import { maybeYield, throwIfAborted } from "@/lib/pdf/yield";

export type WatermarkPos = "diagonal" | "top" | "bottom" | "center";

export type WatermarkOptions = {
  text: string;
  /** 5–100 (percent) */
  opacity: number;
  /** 12–160 (pt) */
  size: number;
  pos: WatermarkPos;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

export type WatermarkResult = {
  blob: Blob;
  filename: string;
  pageCount: number;
};

/** The dict key our remover looks for to identify a CounselPDF watermark. */
export const WATERMARK_MARKER = "CounselPDFWatermark";

async function buildStampPdf(
  width: number,
  height: number,
  opts: WatermarkOptions,
): Promise<Uint8Array> {
  const { text, opacity, size, pos } = opts;
  const stampDoc = await PDFDocument.create();
  const page = stampDoc.addPage([width, height]);
  const font = await embedStandardFont(stampDoc, "HelveticaBold");
  const op = Math.max(0.05, Math.min(1, opacity / 100));
  const tw = font.widthOfTextAtSize(text, size);
  const th = size;
  let x: number;
  let y: number;

  if (pos === "diagonal") {
    x = width / 2 - tw / 2;
    y = height / 2 - th / 2;
    const rot = Math.atan2(height, width) * (180 / Math.PI);
    page.drawText(text, {
      x, y, font, size,
      color: rgb(0.5, 0.5, 0.5),
      opacity: op,
      rotate: degrees(rot),
    });
  } else {
    if (pos === "top") {
      x = width / 2 - tw / 2;
      y = height - th - 36;
    } else if (pos === "bottom") {
      x = width / 2 - tw / 2;
      y = 36;
    } else {
      x = width / 2 - tw / 2;
      y = height / 2 - th / 2;
    }
    page.drawText(text, {
      x, y, font, size,
      color: rgb(0.5, 0.5, 0.5),
      opacity: op,
    });
  }

  return await stampDoc.save({ useObjectStreams: false });
}

export async function applyTextWatermark(
  file: File,
  opts: WatermarkOptions,
): Promise<WatermarkResult> {
  const { text, signal, onProgress } = opts;
  if (!text.trim()) throw new Error("Watermark text is empty");

  const doc = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const pages = doc.getPages();

  // Group pages by size; each distinct size gets one reusable stamp XObject.
  // 3000 pages of the same size = one XObject referenced 3000 times, which
  // the remover then blanks in a single edit.
  const stamps = new Map<string, import("pdf-lib").PDFEmbeddedPage>();

  for (let i = 0; i < pages.length; i++) {
    throwIfAborted(signal);
    const page = pages[i];
    const { width, height } = page.getSize();
    const key = `${width.toFixed(2)}x${height.toFixed(2)}`;
    let stamp = stamps.get(key);
    if (!stamp) {
      const stampBytes = await buildStampPdf(width, height, opts);
      const [embedded] = await doc.embedPdf(stampBytes, [0]);
      stamps.set(key, embedded);
      stamp = embedded;
    }
    page.drawPage(stamp);
    onProgress?.(i + 1, pages.length);
    await maybeYield(i, 16);
  }

  // Tag every stamp Form XObject with our marker so the remover can find it
  // deterministically, regardless of page count.
  for (const stamp of stamps.values()) {
    const obj = doc.context.lookup(stamp.ref);
    if (obj instanceof PDFRawStream) {
      obj.dict.set(PDFName.of(WATERMARK_MARKER), doc.context.obj(true));
    }
  }

  const bytes = await doc.save();
  const base = file.name.replace(/\.pdf$/i, "");
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    filename: `${base}-watermarked.pdf`,
    pageCount: doc.getPageCount(),
  };
}
