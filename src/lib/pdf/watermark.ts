// Text watermark — on-device, fully in browser. Extracted from the
// /watermark route so the workspace panel can reuse the same logic.

import { PDFDocument, degrees, rgb } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";

export type WatermarkPos = "diagonal" | "top" | "bottom" | "center";

export type WatermarkOptions = {
  text: string;
  /** 5–100 (percent) */
  opacity: number;
  /** 12–160 (pt) */
  size: number;
  pos: WatermarkPos;
};

export type WatermarkResult = {
  blob: Blob;
  filename: string;
  pageCount: number;
};

export async function applyTextWatermark(
  file: File,
  opts: WatermarkOptions,
): Promise<WatermarkResult> {
  const { text, opacity, size, pos } = opts;
  if (!text.trim()) throw new Error("Watermark text is empty");

  const doc = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const font = await embedStandardFont(doc, "HelveticaBold");
  const op = Math.max(0.05, Math.min(1, opacity / 100));

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(text, size);
    const th = size;
    let x: number, y: number;
    if (pos === "diagonal") {
      x = width / 2 - tw / 2;
      y = height / 2 - th / 2;
      const rot = Math.atan2(height, width) * (180 / Math.PI);
      page.drawText(text, {
        x,
        y,
        font,
        size,
        color: rgb(0.5, 0.5, 0.5),
        opacity: op,
        rotate: degrees(rot),
      });
      continue;
    }
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
      x,
      y,
      font,
      size,
      color: rgb(0.5, 0.5, 0.5),
      opacity: op,
    });
  }

  const bytes = await doc.save();
  const base = file.name.replace(/\.pdf$/i, "");
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    filename: `${base}-watermarked.pdf`,
    pageCount: doc.getPageCount(),
  };
}
