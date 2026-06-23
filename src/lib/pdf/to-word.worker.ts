// Web Worker that runs the entire PDF → Word conversion off the main thread.
// pdfjs is run in "no nested worker" mode (disableWorker: true) so parsing
// happens inline within this worker. Rendering + image encoding use
// OffscreenCanvas. docx packing happens here too — we ship back a Blob.

/// <reference lib="webworker" />

export type ToWordMode = "flow" | "page" | "fidelity";

export interface WorkerOptions {
  mode: ToWordMode;
  includeImages: boolean;
  fidelityScale: number;
  concurrency: number;
}

type InMessage = { type: "convert"; buffer: ArrayBuffer; options: WorkerOptions };
type OutMessage =
  | { type: "progress"; pct: number; stage: string }
  | { type: "done"; blob: Blob }
  | { type: "error"; message: string };

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

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: OutMessage, transfer?: Transferable[]) =>
  transfer ? ctx.postMessage(msg, transfer) : ctx.postMessage(msg);

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

async function encodeOffscreen(
  canvas: OffscreenCanvas,
  hasAlpha: boolean,
): Promise<{ data: Uint8Array; type: "jpg" | "png" } | null> {
  const opts: ImageEncodeOptions = hasAlpha
    ? { type: "image/png" }
    : { type: "image/jpeg", quality: 0.85 };
  let blob: Blob | null = null;
  try {
    blob = await canvas.convertToBlob(opts);
  } catch {
    return null;
  }
  if (!blob) return null;
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    type: hasAlpha ? "png" : "jpg",
  };
}

async function extractPageImages(
  page: any,
  OPS: any,
): Promise<{ data: Uint8Array; type: "jpg" | "png"; width: number; height: number }[]> {
  const out: { data: Uint8Array; type: "jpg" | "png"; width: number; height: number }[] = [];
  let ops: any;
  try {
    ops = await page.getOperatorList();
  } catch {
    return out;
  }
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
      const canvas = new OffscreenCanvas(w, h);
      const c2d = canvas.getContext("2d");
      if (!c2d) continue;
      let hasAlpha = false;
      if (img.bitmap) {
        c2d.drawImage(img.bitmap, 0, 0);
        hasAlpha = true;
      } else if (img.data) {
        const imageData = c2d.createImageData(w, h);
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
        c2d.putImageData(imageData, 0, 0);
      } else {
        continue;
      }
      const enc = await encodeOffscreen(canvas, hasAlpha);
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
  const w = Math.ceil(viewport.width);
  const h = Math.ceil(viewport.height);
  const canvas = new OffscreenCanvas(w, h);
  const c2d = canvas.getContext("2d");
  if (!c2d) return null;
  c2d.fillStyle = "#ffffff";
  c2d.fillRect(0, 0, w, h);
  await page.render({ canvasContext: c2d, viewport }).promise;
  const enc = await encodeOffscreen(canvas, false);
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

async function convert(buffer: ArrayBuffer, options: WorkerOptions): Promise<Blob> {
  const { mode, includeImages, fidelityScale, concurrency } = options;

  // pdfjs in "no nested worker" mode → parses inline in this worker.
  const pdfjs: any = await import("pdfjs-dist");
  const OPS = pdfjs.OPS;
  const docxMod: any = await import("docx");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    PageBreak,
    HeadingLevel,
    ImageRun,
    AlignmentType,
  } = docxMod;

  const loadingTask = pdfjs.getDocument({ data: buffer, disableWorker: true });
  const doc = await loadingTask.promise;
  const numPages: number = doc.numPages;
  const MAX_IMG_W_PT = 468;

  let completed = 0;
  const tick = () => {
    completed++;
    post({
      type: "progress",
      pct: Math.round((completed / numPages) * 100),
      stage: `Reading pages… ${completed}/${numPages}`,
    });
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
              }),
            ],
          }),
        );
      }
      return out;
    }

    // Run text + image extraction concurrently (instead of serially).
    const [content, images] = await Promise.all([
      page.getTextContent(),
      includeImages ? extractPageImages(page, OPS) : Promise.resolve([]),
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
              }),
            ],
          }),
        );
      }
    }

    return out;
  };

  const perPage = await runWithConcurrency(numPages, concurrency, buildPage, tick);
  const allChildren: any[] = perPage.flat();

  post({ type: "progress", pct: 100, stage: "Packing .docx…" });

  const docx = new Document({
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [{ children: allChildren }],
  });

  return Packer.toBlob(docx);
}

ctx.addEventListener("message", async (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.type !== "convert") return;
  try {
    const blob = await convert(msg.buffer, msg.options);
    post({ type: "done", blob });
  } catch (err: any) {
    post({ type: "error", message: err?.message ?? String(err) });
  }
});
