// PDF → Images conversion, on-device. Renders each page via pdfjs to PNG or
// JPG and bundles multi-page output in a zip.

import { loadPdfjs } from "@/lib/pdf/worker";

export type ToImagesFormat = "png" | "jpg";

export interface ToImagesOptions {
  format?: ToImagesFormat;
  dpi?: number;
  /** JPG quality 0..1 (ignored for PNG). */
  quality?: number;
  onProgress?: (pct: number) => void;
}

export interface ToImagesResult {
  blob: Blob;
  filename: string;
  pages: number;
  isZip: boolean;
}

export async function convertPdfToImages(
  file: File,
  options: ToImagesOptions = {},
): Promise<ToImagesResult> {
  const format = options.format ?? "png";
  const dpi = options.dpi ?? 150;
  const quality = options.quality ?? 0.92;
  const onProgress = options.onProgress ?? (() => {});

  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const scale = dpi / 72;
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const ext = format === "png" ? "png" : "jpg";
  const base = file.name.replace(/\.pdf$/i, "");

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const pad = String(doc.numPages).length;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d")!;
    if (format === "jpg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    const blob: Blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b!), mime, format === "jpg" ? quality : undefined),
    );
    zip.file(`${base}-p${String(i).padStart(pad, "0")}.${ext}`, blob);
    onProgress(Math.round((i / doc.numPages) * 100));
  }

  if (doc.numPages === 1) {
    const only = await zip.file(/.*/)[0].async("blob");
    return { blob: only, filename: `${base}.${ext}`, pages: 1, isZip: false };
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  return { blob: zipBlob, filename: `${base}-images.zip`, pages: doc.numPages, isZip: true };
}
