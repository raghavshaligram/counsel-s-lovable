/**
 * Compress — guaranteed never to return a larger file than the input.
 *
 * Two strategies run SEQUENTIALLY (never in parallel — that doubled peak
 * memory and OOM'd 3000-page docs) and we keep the smaller result:
 *
 *   A. Structural rebuild (pdf-lib re-save with object streams + metadata
 *      dropped). Fast, lossless, wins on text/vector PDFs whose images
 *      are already efficient — exactly the case where rasterising made
 *      the file BIGGER. Re-encodes nothing.
 *
 *   B. Rasterise pipeline (pdf.js → JPEG re-encode at preset quality).
 *      Wins on scan-heavy / image-heavy PDFs. Yields to the event loop
 *      every few pages and nulls each page canvas so GC can reclaim it
 *      before allocating the next one.
 *
 * Safeguard: if neither beats the original, we return the original bytes
 * and report `keptOriginal: true`. A Compress action MUST NEVER hand the
 * user a larger file.
 */
import { PDFDocument } from "pdf-lib";
import { openPdfjs, type PasswordPrompt } from "@/lib/pdf/pdf-open";
import { maybeYield, throwIfAborted } from "@/lib/pdf/yield";

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
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, phase: "structural" | "rasterise") => void;
  onPassword?: PasswordPrompt;
}

export type CompressMethod = "structural" | "rasterise" | "kept-original";

export interface CompressResult {
  bytes: Uint8Array;
  originalSize: number;
  outputSize: number;
  /** True when neither strategy beat the original — we returned the source. */
  keptOriginal: boolean;
  method: CompressMethod;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Strategy A — lossless structural rebuild via pdf-lib. */
async function compressStructural(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
    try { doc.setTitle(""); } catch { /* noop */ }
    try { doc.setAuthor(""); } catch { /* noop */ }
    try { doc.setSubject(""); } catch { /* noop */ }
    try { doc.setKeywords([]); } catch { /* noop */ }
    try { doc.setProducer("PDFMacro"); } catch { /* noop */ }
    try { doc.setCreator("PDFMacro"); } catch { /* noop */ }
    return await doc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 200,
    });
  } catch (e) {
    console.warn("[compress] structural rebuild failed", e);
    return null;
  }
}

/** Strategy B — rasterise each page as JPEG at the preset's DPI/quality. */
async function compressRasterise(
  bytes: Uint8Array,
  opts: CompressOpts,
): Promise<Uint8Array | null> {
  try {
    const { dpi, quality } = COMPRESS_PRESETS[opts.preset];
    const scale = dpi / 72;
    const srcDoc = await openPdfjs(bytes.slice(), { onPassword: opts.onPassword });
    const sizingDoc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
    const sizes = sizingDoc.getPages().map((p) => ({ w: p.getWidth(), h: p.getHeight() }));

    const out = await PDFDocument.create();
    for (let i = 0; i < srcDoc.numPages; i++) {
      throwIfAborted(opts.signal);
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

      // Free the pdf.js page + canvas allocation before the next iter so a
      // 3000-page doc doesn't accumulate canvas RAM.
      try { page.cleanup(); } catch { /* noop */ }
      canvas.width = 0;
      canvas.height = 0;

      opts.onProgress?.(i + 1, srcDoc.numPages, "rasterise");
      await maybeYield(i, 4);
    }

    out.setTitle("");
    out.setAuthor("");
    out.setSubject("");
    out.setKeywords([]);
    out.setProducer("PDFMacro");
    out.setCreator("PDFMacro");
    return await out.save({ useObjectStreams: true });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    console.warn("[compress] rasterise failed", e);
    return null;
  }
}

/**
 * Smart compress — runs strategies SEQUENTIALLY, returns the smaller
 * result, and NEVER returns bytes larger than the input.
 */
export async function compressSmart(
  bytes: Uint8Array,
  opts: CompressOpts,
): Promise<CompressResult> {
  const originalSize = bytes.byteLength;

  // Sequential — running both in parallel was the source of the 2× peak.
  opts.onProgress?.(0, 1, "structural");
  const structural = await compressStructural(bytes);
  opts.onProgress?.(1, 1, "structural");
  throwIfAborted(opts.signal);

  const rasterised = await compressRasterise(bytes, opts);
  throwIfAborted(opts.signal);

  type Candidate = { bytes: Uint8Array; method: CompressMethod };
  const candidates: Candidate[] = [];
  if (structural) candidates.push({ bytes: structural, method: "structural" });
  if (rasterised) candidates.push({ bytes: rasterised, method: "rasterise" });

  let best: Candidate | null = null;
  for (const c of candidates) {
    if (c.bytes.byteLength >= originalSize) continue;
    if (!best || c.bytes.byteLength < best.bytes.byteLength) best = c;
  }

  if (!best) {
    return {
      bytes,
      originalSize,
      outputSize: originalSize,
      keptOriginal: true,
      method: "kept-original",
    };
  }
  return {
    bytes: best.bytes,
    originalSize,
    outputSize: best.bytes.byteLength,
    keptOriginal: false,
    method: best.method,
  };
}

/** Back-compat wrapper. Always returns bytes <= input size. */
export async function compress(bytes: Uint8Array, opts: CompressOpts): Promise<Uint8Array> {
  const res = await compressSmart(bytes, opts);
  return res.bytes;
}
