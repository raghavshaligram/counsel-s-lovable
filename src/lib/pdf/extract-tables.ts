// Heuristic PDF table extraction, fully in-browser.
//
// Approach: pull text items with their device-space positions, cluster items
// by Y to form rows, then within each row cluster by X gaps to form columns.
// Build a consistent column grid by aligning rows on shared X centroids.
//
// Good enough for most invoices, bank statements, lab reports, SEC filings.
// Falls back to OCR for scanned pages.

import { loadPdfjs } from "./worker";
import { importChunk } from "@/lib/chunk-import";

export type ExtractedTable = {
  page: number;
  rows: string[][];
  source: "text" | "ocr";
};

export type ExtractProgress = {
  page: number;
  totalPages: number;
  stage: "text" | "ocr";
};

type Item = { str: string; x: number; y: number; w: number; h: number };

export async function extractTables(
  file: File,
  scale = 1.5,
  onProgress?: (p: ExtractProgress) => void,
): Promise<ExtractedTable[]> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf, enableXfa: true, useSystemFonts: true }).promise;
  const out: ExtractedTable[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.({ page: i, totalPages: doc.numPages, stage: "text" });
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const content = await page.getTextContent();
    const rawItems = content.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;

    const items: Item[] = rawItems
      .filter((it) => it.str && it.str.trim().length > 0)
      .map((it) => {
        const m = pdfjs.Util.transform(viewport.transform, it.transform);
        const fontHeight = Math.hypot(m[2], m[3]);
        return {
          str: it.str,
          x: m[4],
          y: m[5] - fontHeight,
          w: it.width * scale,
          h: fontHeight,
        };
      });

    if (items.length < 4) {
      // Image-only page → OCR
      onProgress?.({ page: i, totalPages: doc.numPages, stage: "ocr" });
      const ocrItems = await ocrPageItems(page as unknown as Parameters<typeof ocrPageItems>[0], viewport);
      if (ocrItems.length > 0) {
        const rows = itemsToTable(ocrItems);
        if (rows.length > 0) out.push({ page: i, rows, source: "ocr" });
      }
      continue;
    }

    const rows = itemsToTable(items);
    if (rows.length > 0) out.push({ page: i, rows, source: "text" });
  }

  return out;
}

async function ocrPageItems(
  page: { render: (args: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas: HTMLCanvasElement }) => { promise: Promise<unknown> } },
  viewport: { width: number; height: number },
): Promise<Item[]> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const { createWorker } = await importChunk(() => import("tesseract.js"));
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words = collectWords(data);
    return words.map((w) => ({
      str: w.text,
      x: w.bbox.x0,
      y: w.bbox.y0,
      w: w.bbox.x1 - w.bbox.x0,
      h: w.bbox.y1 - w.bbox.y0,
    }));
  } finally {
    await worker.terminate();
  }
}

type OcrWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
function collectWords(data: unknown): OcrWord[] {
  const out: OcrWord[] = [];
  const visit = (node: Record<string, unknown> | null | undefined) => {
    if (!node) return;
    const words = node.words as OcrWord[] | undefined;
    if (Array.isArray(words)) out.push(...words);
    for (const key of ["blocks", "paragraphs", "lines"]) {
      const arr = node[key] as Record<string, unknown>[] | undefined;
      if (Array.isArray(arr)) arr.forEach(visit);
    }
  };
  visit(data as Record<string, unknown>);
  return out.filter((w) => w.text && w.text.trim().length > 0);
}

function itemsToTable(items: Item[]): string[][] {
  if (items.length === 0) return [];
  // Sort top-to-bottom, then left-to-right
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const avgH =
    sorted.reduce((s, it) => s + it.h, 0) / sorted.length || 10;
  const rowTol = avgH * 0.6;

  // Cluster into rows by Y
  const rowGroups: Item[][] = [];
  for (const it of sorted) {
    const last = rowGroups[rowGroups.length - 1];
    if (last && Math.abs(it.y - last[0].y) <= rowTol) last.push(it);
    else rowGroups.push([it]);
  }

  // Within each row, cluster horizontally adjacent items into a single cell
  const avgCharW = sorted.reduce((s, it) => s + it.w / Math.max(1, it.str.length), 0) / sorted.length || 4;
  const cellGap = avgCharW * 2.2;

  type Cell = { x: number; right: number; text: string };
  const rowCells: Cell[][] = rowGroups.map((group) => {
    const g = [...group].sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of g) {
      const last = cells[cells.length - 1];
      if (last && it.x - last.right <= cellGap) {
        last.text += " " + it.str;
        last.right = Math.max(last.right, it.x + it.w);
      } else {
        cells.push({ x: it.x, right: it.x + it.w, text: it.str });
      }
    }
    return cells.map((c) => ({ ...c, text: c.text.trim() }));
  });

  // Build column anchors as the union of cell start positions (cluster them)
  const anchors: number[] = [];
  const anchorTol = avgCharW * 4;
  const flat = rowCells.flat().map((c) => c.x).sort((a, b) => a - b);
  for (const x of flat) {
    if (anchors.length === 0 || x - anchors[anchors.length - 1] > anchorTol) {
      anchors.push(x);
    }
  }
  if (anchors.length < 2) {
    // No meaningful columns — return raw text per row
    return rowCells.map((cells) => [cells.map((c) => c.text).join(" ")]);
  }

  // Place each cell into the nearest column
  const table: string[][] = rowCells.map((cells) => {
    const row: string[] = new Array(anchors.length).fill("");
    for (const c of cells) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        const d = Math.abs(anchors[i] - c.x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      row[best] = row[best] ? row[best] + " " + c.text : c.text;
    }
    return row;
  });

  // Drop trailing empty columns
  let lastNonEmpty = -1;
  for (const r of table) {
    for (let i = r.length - 1; i > lastNonEmpty; i--) {
      if (r[i]) {
        lastNonEmpty = i;
        break;
      }
    }
  }
  if (lastNonEmpty >= 0 && lastNonEmpty < anchors.length - 1) {
    return table.map((r) => r.slice(0, lastNonEmpty + 1));
  }
  return table;
}

export function rowsToCsv(rows: string[][]): string {
  const esc = (s: string) =>
    /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return rows.map((r) => r.map((c) => esc(c ?? "")).join(",")).join("\n");
}

export async function downloadXlsx(
  tables: ExtractedTable[],
  filename: string,
) {
  const XLSX = await importChunk(() => import("xlsx"));
  const wb = XLSX.utils.book_new();
  for (const t of tables) {
    const ws = XLSX.utils.aoa_to_sheet(t.rows);
    XLSX.utils.book_append_sheet(wb, ws, `Page ${t.page}`.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}
