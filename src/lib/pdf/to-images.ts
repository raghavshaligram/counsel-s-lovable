// PDF → Images conversion, on-device. Renders each page via pdfjs to PNG or
// JPG and bundles multi-page output in a zip.

import { loadPdfjs } from "@/lib/pdf/worker";

export type ToImagesFormat = "png" | "jpg";

export interface ToImagesOptions {
  format?: ToImagesFormat;
  dpi?: number;
  /** JPG quality 0..1 (ignored for PNG). */
  quality?: number;
  /** Optional page range, e.g. "1-3,7,10-12". Omit/empty = all pages. */
  pages?: string;
  onProgress?: (pct: number) => void;
}

export interface ToImagesResult {
  blob: Blob;
  filename: string;
  pages: number;
  isZip: boolean;
}

/**
 * Parse a page range expression like "1-3,7,10-12" into a sorted unique list
 * of 1-based page numbers, clamped to [1, total]. Returns all pages if the
 * expression is empty, whitespace-only, or unparseable.
 */
export function parsePageRange(expr: string | undefined, total: number): number[] {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  if (!expr || !expr.trim()) return all;
  const out = new Set<number>();
  for (const raw of expr.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= total) out.add(n);
    }
  }
  if (!out.size) return all;
  return Array.from(out).sort((a, b) => a - b);
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

  const pageNums = parsePageRange(options.pages, doc.numPages);

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const pad = String(doc.numPages).length;

  for (let idx = 0; idx < pageNums.length; idx++) {
    const i = pageNums[idx];
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
    onProgress(Math.round(((idx + 1) / pageNums.length) * 100));
  }

  if (pageNums.length === 1) {
    const only = await zip.file(/.*/)[0].async("blob");
    return { blob: only, filename: `${base}-p${pageNums[0]}.${ext}`, pages: 1, isZip: false };
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  return { blob: zipBlob, filename: `${base}-images.zip`, pages: pageNums.length, isZip: true };
}
