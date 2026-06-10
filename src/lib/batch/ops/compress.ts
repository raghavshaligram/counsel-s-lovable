/**
 * Compress op — bytes -> bytes. Mirrors the Compress route pipeline.
 *
 * Each page is rasterized via pdf.js at the chosen DPI, re-encoded as JPEG
 * at the chosen quality, and rebuilt into a fresh PDF. Optionally grayscale.
 */
import { PDFDocument } from "pdf-lib";
import { loadPdfjs } from "@/lib/pdf/worker";

export type CompressPreset = "low" | "medium" | "high" | "extreme";

export const COMPRESS_PRESETS: Record<CompressPreset, { dpi: number; quality: number }> = {
  low:     { dpi: 200, quality: 0.92 },
  medium:  { dpi: 150, quality: 0.80 },
  high:    { dpi: 100, quality: 0.65 },
  extreme: { dpi: 72,  quality: 0.50 },
};

export interface CompressOpts {
  preset: CompressPreset;
  grayscale: boolean;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function compress(bytes: Uint8Array, opts: CompressOpts): Promise<Uint8Array> {
  const { dpi, quality } = COMPRESS_PRESETS[opts.preset];
  const scale = dpi / 72;
  const pdfjs = await loadPdfjs();
  const srcDoc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const sizingDoc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
  const sizes = sizingDoc.getPages().map((p) => ({ w: p.getWidth(), h: p.getHeight() }));

  const out = await PDFDocument.create();
  for (let i = 0; i < srcDoc.numPages; i++) {
    const page = await srcDoc.getPage(i + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    if (opts.grayscale) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      for (let p = 0; p < d.length; p += 4) {
        const g = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        d[p] = d[p + 1] = d[p + 2] = g;
      }
      ctx.putImageData(img, 0, 0);
    }

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const jpg = await out.embedJpg(dataUrlToBytes(dataUrl));
    const sz = sizes[i] ?? { w: viewport.width / scale, h: viewport.height / scale };
    const p = out.addPage([sz.w, sz.h]);
    p.drawImage(jpg, { x: 0, y: 0, width: sz.w, height: sz.h });
  }

  out.setTitle("");
  out.setAuthor("");
  out.setSubject("");
  out.setKeywords([]);
  out.setProducer("VaultPDF");
  out.setCreator("VaultPDF");
  return out.save();
}
