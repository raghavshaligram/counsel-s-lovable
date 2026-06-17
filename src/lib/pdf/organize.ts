/**
 * Organize — extracted primitives.
 *
 * Pulled OUT of the /organize route with NO logic change — just relocation
 * so the new workspace panel + canvas grid can call the same code.
 *
 * Exports:
 *   - PageCell, Rotation types
 *   - buildPdfFromCells(cells, sources) — composes a new PDF
 *   - renderPageThumb(...)              — pdf.js page → jpeg dataURL
 *
 * 100% on-device. No network. Reuse only — do not duplicate.
 */
import { PDFDocument } from "pdf-lib";
import { loadPdfjs } from "./worker";

export type Rotation = 0 | 90 | 180 | 270;

/** A single tile in the organize grid. `source` indexes into a source map
 *  the caller maintains (e.g. "active" + tray-entry ids). */
export interface PageCell {
  cellId: string;
  source: string;
  fileName: string;
  /** 0-based page index in the source PDF. */
  pageIndex: number;
  rotation: Rotation;
  thumb?: string;
}

export interface OrganizeSource {
  bytes: Uint8Array;
  fileName: string;
  pageCount: number;
}

/** Compose a new PDF from an ordered list of cells. Pure I/O — accepts a
 *  source resolver so the caller controls where bytes come from (active
 *  tab File vs tray IndexedDB). Identical logic to the original
 *  buildPdf() in src/routes/organize.tsx. */
export async function buildPdfFromCells(
  cells: PageCell[],
  resolveSource: (key: string) => Promise<Uint8Array | null> | Uint8Array | null,
): Promise<Uint8Array> {
  if (cells.length === 0) throw new Error("No pages to build");
  const sourceDocs = new Map<string, PDFDocument>();
  const out = await PDFDocument.create();
  for (const c of cells) {
    let src = sourceDocs.get(c.source);
    if (!src) {
      const bytes = await resolveSource(c.source);
      if (!bytes) throw new Error(`Missing bytes for ${c.fileName}`);
      src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      sourceDocs.set(c.source, src);
    }
    const [copied] = await out.copyPages(src, [c.pageIndex]);
    if (c.rotation) {
      const cur = copied.getRotation().angle;
      copied.setRotation({ type: "degrees", angle: (cur + c.rotation) % 360 } as never);
    }
    out.addPage(copied);
  }
  return await out.save();
}

/** Render a single page of a pdf.js document as a jpeg dataURL thumbnail.
 *  Identical to the inline renderer in the original organize route. */
export async function renderPageThumb(
  pdfjsDoc: { getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> } }> },
  pageIndex: number,
  scale = 1.0,
  quality = 0.78,
): Promise<string | null> {
  const page = await pdfjsDoc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
  return canvas.toDataURL("image/jpeg", quality);
}

/** Open a pdf.js document for the given bytes. Caller may cache by source. */
export async function openPdfjsDoc(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data: bytes.slice() }).promise as Promise<{
    numPages: number;
    getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> } }>;
  }>;
}

/** Stable palette for per-source color stripes. */
export const ORGANIZE_PALETTE = [
  "hsl(174 70% 45%)",
  "hsl(28 85% 60%)",
  "hsl(280 60% 65%)",
  "hsl(200 75% 55%)",
  "hsl(45 85% 55%)",
  "hsl(340 70% 60%)",
  "hsl(140 50% 50%)",
  "hsl(15 75% 60%)",
];
