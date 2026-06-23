// PDF → Word (DOCX) conversion. Pure on-device.
//
// pdfjs already runs its own dedicated web worker for parsing, so the heavy
// PDF work is off the main thread. This module does pages in parallel,
// fetches text + images concurrently per page, and encodes images as JPEG
// (much faster than PNG) for a snappy on-device conversion.

import { loadPdfjs } from "@/lib/pdf/worker";

export type ToWordMode = "flow" | "page" | "fidelity";

export interface ToWordOptions {
  mode?: ToWordMode;
  includeImages?: boolean; // default false (fast text-only)
  fidelityScale?: number; // default 1.5
  concurrency?: number; // default = clamp(navigator.hardwareConcurrency, 2, 8)
  onProgress?: (pct: number, stage?: string) => void;
}

type StyledItem = {
  str: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  italic: boolean;
};

type StyledLine = {
  y: number;
  size: number;
  parts: { x: number; str: string; bold: boolean; italic: boolean; size: number }[];
};

function isBoldFont(name: string): boolean {
  return /bold|black|heavy|semibold|demibold/i.test(name);
}
function isItalicFont(name: string): boolean {
  return /italic|oblique/i.test(name);
}

// O(n) line grouping via Y-bucket Map.
function groupStyledLines(items: StyledItem[]): StyledLine[] {
  const TOL_BASE = 2;
  const buckets = new Map<number, StyledLine>();
  for (const it of items) {
    if (!it.str) continue;
    const tol = Math.max(TOL_BASE, it.size * 0.4);
    const key = Math.round(it.y / tol);
    let row = buckets.get(key);
    if (!row) {
      row = { y: it.y, size: it.size, parts: [] };
      buckets.set(key, row);
    }
    row.parts.push({ x: it.x, str: it.str, bold: it.bold, italic: it.italic, size: it.size });
  }
  const rows = Array.from(buckets.values());
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.parts.sort((a, b) => a.x - b.x);
  return rows;
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  hasAlpha: boolean,
): Promise<{ data: Uint8Array; type: "jpg" | "png" } | null> {
  const mime = hasAlpha ? "image/png" : "image/jpeg";
  const quality = hasAlpha ? undefined : 0.85;
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), mime, quality),
  );
  if (!blob) return null;
  const data = new Uint8Array(await blob.arrayBuffer());
  return { data, type: hasAlpha ? "png" : "jpg" };
}

async function extractPageImages(
  page: any,
): Promise<{ data: Uint8Array; type: "jpg" | "png"; width: number; height: number }[]> {
  const out: { data: Uint8Array; type: "jpg" | "png"; width: number; height: number }[] = [];
  let ops: any;
  try {
    ops = await page.getOperatorList();
  } catch {
    return out;
  }
  const pdfjs = await loadPdfjs();
  const OPS = (pdfjs as any).OPS;
  const imageOps = new Set([
    OPS.paintImageXObject,
    OPS.paintJpegXObject,
    OPS.paintImageXObjectRepeat,
  ]);
  const names: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (imageOps.has(ops.fnArray[i])) {
      const name = ops.argsArray[i]?.[0];
      if (typeof name === "string" && !names.includes(name)) names.push(name);
    }
  }
  for (const name of names) {
    try {
      const img: any = await new Promise((resolve, reject) => {
        try {
          page.objs.get(name, (o: any) => resolve(o));
        } catch (e) {
          reject(e);
        }
      });
      if (!img) continue;
      const w = img.width;
      const h = img.height;
      if (!w || !h) continue;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      let hasAlpha = false;
      if (img.bitmap) {
        ctx.drawImage(img.bitmap, 0, 0);
        hasAlpha = true;
      } else if (img.data) {
        const imageData = ctx.createImageData(w, h);
        const src = img.data as Uint8ClampedArray | Uint8Array;
        if (src.length === w * h * 4) {
          imageData.data.set(src);
          hasAlpha = true;
        } else if (src.length === w * h * 3) {
          for (let p = 0, q = 0; p < src.length; p += 3, q += 4) {
            imageData.data[q] = src[p];
            imageData.data[q + 1] = src[p + 1];
            imageData.data[q + 2] = src[p + 2];
            imageData.data[q + 3] = 255;
          }
        } else {
          continue;
        }
        ctx.putImageData(imageData, 0, 0);
      } else {
        continue;
      }
      const enc = await encodeCanvas(canvas, hasAlpha);
      canvas.width = 0;
      canvas.height = 0;
      if (!enc) continue;
      out.push({ data: enc.data, type: enc.type, width: w, height: h });
    } catch {
      // skip
    }
  }
  return out;
}

async function renderPageToImage(
  page: any,
  scale: number,
): Promise<{ data: Uint8Array; type: "jpg" | "png"; width: number; height: number } | null> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const w = canvas.width;
  const h = canvas.height;
  const enc = await encodeCanvas(canvas, false);
  canvas.width = 0;
  canvas.height = 0;
  if (!enc) return null;
  return { data: enc.data, type: enc.type, width: w, height: h };
}

async function runWithConcurrency<T>(
  count: number,
  limit: number,
  task: (index: number) => Promise<T>,
  onDone?: () => void,
): Promise<T[]> {
  const results: T[] = new Array(count);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, count) }, async () => {
    while (true) {
      const i = next++;
      if (i >= count) return;
      results[i] = await task(i);
      onDone?.();
    }
  });
  await Promise.all(workers);
  return results;
}

function pickConcurrency(override?: number): number {
  if (typeof override === "number" && override > 0) return Math.min(8, Math.max(1, override));
  const hw =
    typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 4;
  return Math.max(2, Math.min(8, hw));
}

export async function convertPdfToWordBlob(
  file: File,
  options: ToWordOptions = {},
): Promise<Blob> {
  const mode: ToWordMode = options.mode ?? "flow";
  const includeImages = options.includeImages ?? false;
  const fidelityScale = options.fidelityScale ?? 1.5;
  const concurrency = pickConcurrency(options.concurrency);
  const onProgress = options.onProgress;

  const pdfjs = await loadPdfjs();
  const { Document, Packer, Paragraph, TextRun, PageBreak, HeadingLevel, ImageRun, AlignmentType } =
    await import("docx");
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const numPages: number = doc.numPages;
  const MAX_IMG_W_PT = 468;

  let completed = 0;
  const tick = () => {
    completed++;
    onProgress?.(
      Math.round((completed / numPages) * 100),
      `Reading pages… ${completed}/${numPages}`,
    );
  };

  const buildPage = async (pageIndex: number): Promise<any[]> => {
    const pageNumber = pageIndex + 1;
    const page = await doc.getPage(pageNumber);
    const out: any[] = [];

    if (pageIndex > 0 && (mode === "page" || mode === "fidelity")) {
      out.push(new Paragraph({ children: [new PageBreak()] }));
    }
    if (mode === "page") {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: `Page ${pageNumber}`, bold: true, color: "888888" })],
        }),
      );
    }

    if (mode === "fidelity") {
      const img = await renderPageToImage(page, fidelityScale);
      if (img) {
        const viewport = page.getViewport({ scale: 1 });
        const ratio = img.height / img.width;
        const wPt = Math.min(MAX_IMG_W_PT, viewport.width);
        const hPt = wPt * ratio;
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: img.type,
                data: img.data,
                transformation: { width: wPt, height: hPt },
              } as any),
            ],
          }),
        );
      }
      return out;
    }

    // Concurrent text + image extraction.
    const [content, images] = await Promise.all([
      page.getTextContent(),
      includeImages ? extractPageImages(page) : Promise.resolve([]),
    ]);

    const styles: Record<string, any> = (content as any).styles ?? {};
    const items: StyledItem[] = (content.items as any[])
      .filter((it) => it && typeof it.str === "string")
      .map((it) => {
        const tr = it.transform as number[];
        const fontName: string = it.fontName ?? "";
        const styleEntry = styles[fontName] ?? {};
        const familyName: string = styleEntry.fontFamily ?? "";
        const bold = isBoldFont(fontName) || isBoldFont(familyName);
        const italic = isItalicFont(fontName) || isItalicFont(familyName);
        return {
          str: it.str,
          x: tr[4],
          y: tr[5],
          size: Math.hypot(tr[2], tr[3]) || it.height || 10,
          bold,
          italic,
        };
      });

    const rows = groupStyledLines(items);
    for (const r of rows) {
      const runs: { text: string; bold: boolean; italic: boolean; size: number }[] = [];
      for (const p of r.parts) {
        const last = runs[runs.length - 1];
        const sized = Math.max(16, Math.min(36, Math.round(p.size * 2)));
        if (last && last.bold === p.bold && last.italic === p.italic && last.size === sized) {
          last.text += (last.text.endsWith(" ") ? "" : " ") + p.str;
        } else {
          runs.push({ text: p.str, bold: p.bold, italic: p.italic, size: sized });
        }
      }
      if (!runs.length || runs.every((r) => !r.text.trim())) {
        out.push(new Paragraph({ children: [new TextRun("")] }));
        continue;
      }
      out.push(
        new Paragraph({
          children: runs.map(
            (r) =>
              new TextRun({
                text: r.text.replace(/\s+/g, " "),
                bold: r.bold,
                italics: r.italic,
                size: r.size,
              }),
          ),
        }),
      );
    }

    if (images.length) {
      const viewport = page.getViewport({ scale: 1 });
      for (const img of images) {
        const aspect = img.height / img.width;
        const wPt = Math.min(MAX_IMG_W_PT, Math.min(img.width, viewport.width));
        const hPt = wPt * aspect;
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: img.type,
                data: img.data,
                transformation: { width: wPt, height: hPt },
              } as any),
            ],
          }),
        );
      }
    }

    return out;
  };

  const perPage = await runWithConcurrency(numPages, concurrency, buildPage, tick);
  const allChildren: any[] = perPage.flat();

  onProgress?.(100, "Packing .docx…");

  const docx = new Document({
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [{ children: allChildren }],
  });

  return Packer.toBlob(docx);
}
