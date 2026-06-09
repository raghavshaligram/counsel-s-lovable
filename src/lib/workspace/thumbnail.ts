// Renders page 1 of a PDF to a small JPEG data URL for the file rail thumbnail.
// Uses pdfjs-dist (already in deps). Failures return undefined — non-blocking.

export async function pdfThumbnail(blob: Blob, maxWidth = 96): Promise<string | undefined> {
  try {
    const pdfjs = await import("pdfjs-dist");
    // Wire the worker once.
    if (!(pdfjs.GlobalWorkerOptions as { workerSrc?: string }).workerSrc) {
      const workerUrl = (
        await import("pdfjs-dist/build/pdf.worker.min.mjs?url" as string)
      ).default as string;
      (pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc = workerUrl;
    }
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
    // pdfjs v6 has a stricter render signature in some types — cast keeps it permissive.
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
