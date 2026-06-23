// Images → PDF, on-device. Embeds JPG/PNG into a pdf-lib document with the
// chosen page size and fit. Order = order of the input array.

import { PDFDocument } from "pdf-lib";

export type ImagesPageSize = "auto" | "letter" | "a4";
export type ImagesFit = "fit" | "fill";

export const IMAGES_PAGE_SIZES: Record<
  Exclude<ImagesPageSize, "auto">,
  { w: number; h: number; label: string }
> = {
  letter: { w: 612, h: 792, label: "US Letter" },
  a4: { w: 595.28, h: 841.89, label: "A4" },
};

export interface ImagesToPdfOptions {
  pageSize?: ImagesPageSize;
  fit?: ImagesFit;
  margin?: number;
  onProgress?: (pct: number) => void;
}

export interface ImagesToPdfResult {
  blob: Blob;
  filename: string;
  pages: number;
}

export async function buildPdfFromImages(
  files: File[],
  options: ImagesToPdfOptions = {},
): Promise<ImagesToPdfResult> {
  const pageSize = options.pageSize ?? "auto";
  const fit = options.fit ?? "fit";
  const margin = options.margin ?? 24;
  const onProgress = options.onProgress ?? (() => {});

  const doc = await PDFDocument.create();
  let idx = 0;
  for (const f of files) {
    const bytes = await f.arrayBuffer();
    const isPng = /png/i.test(f.type) || /\.png$/i.test(f.name);
    const embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

    let pw: number;
    let ph: number;
    if (pageSize === "auto") {
      pw = embedded.width;
      ph = embedded.height;
    } else {
      ({ w: pw, h: ph } = IMAGES_PAGE_SIZES[pageSize]);
    }
    const page = doc.addPage([pw, ph]);

    if (pageSize === "auto") {
      page.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });
    } else {
      const aw = pw - margin * 2;
      const ah = ph - margin * 2;
      const scale =
        fit === "fit"
          ? Math.min(aw / embedded.width, ah / embedded.height)
          : Math.max(aw / embedded.width, ah / embedded.height);
      const dw = embedded.width * scale;
      const dh = embedded.height * scale;
      page.drawImage(embedded, {
        x: (pw - dw) / 2,
        y: (ph - dh) / 2,
        width: dw,
        height: dh,
      });
    }
    idx += 1;
    onProgress(Math.round((idx / files.length) * 100));
  }

  const bytes = await doc.save();
  const base = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : "images";
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    filename: `${base}.pdf`,
    pages: files.length,
  };
}
