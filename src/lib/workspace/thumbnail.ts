// Renders page 1 of a PDF to a small JPEG data URL for the file rail thumbnail.
// Uses the shared pdfjs loader. Failures return undefined — non-blocking.

import { loadPdfjs } from "@/lib/pdf/worker";

export async function pdfThumbnail(blob: Blob, maxWidth = 96): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    const pdfjs = await loadPdfjs();
    const buf = await blob.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maxWidth / baseViewport.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    await (page.render as unknown as (p: unknown) => { promise: Promise<void> })({
      canvas,
      canvasContext: ctx,
      viewport,
    }).promise;
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  }
}
