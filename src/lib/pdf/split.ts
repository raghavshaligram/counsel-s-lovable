/**
 * Split PDF — deterministic, on-device.
 *
 * Pure logic extracted from the standalone /split route so the workspace
 * inspector can reuse it without embedding the page.
 */
import { PDFDocument } from "pdf-lib";
import { importChunk } from "@/lib/chunk-import";

export type SplitMode = "ranges" | "each";

export type ParsedRanges = {
  groups: number[][]; // 1-based page numbers
  error?: string;
};

/** Parse "1-3, 5, 8-" against a total page count. */
export function parseRanges(input: string, total: number): ParsedRanges {
  if (!total) return { groups: [] };
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { groups: [] };
  const groups: number[][] = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d*))?$/);
    if (!m) return { groups: [], error: `"${part}" isn't a valid range` };
    const start = parseInt(m[1], 10);
    const endRaw = m[2];
    const end =
      endRaw === undefined ? start : endRaw === "" ? total : parseInt(endRaw, 10);
    if (start < 1 || end < 1 || start > total || end > total) {
      return { groups: [], error: `"${part}" is out of bounds (1–${total})` };
    }
    if (end < start) return { groups: [], error: `"${part}" goes backwards` };
    const pages: number[] = [];
    for (let i = start; i <= end; i++) pages.push(i);
    groups.push(pages);
  }
  return { groups };
}

/** Get the page count of a PDF file (ignores encryption). */
export async function getPageCount(file: File): Promise<number> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  return doc.getPageCount();
}

export type SplitResult =
  | { kind: "pdf"; blob: Blob; filename: string; pageCount: number }
  | { kind: "zip"; blob: Blob; filename: string; fileCount: number; pageCount: number };

export type SplitOptions =
  | { mode: "each" }
  | { mode: "ranges"; ranges: string }
  | { mode: "everyN"; n: number }
  | { mode: "splitPoints"; points: string };

export type ParsedPoints = {
  points: number[]; // sorted, unique, 1-based, strictly > 1 and <= total
  error?: string;
};

/** Parse "5, 12, 18" — pages where a NEW part begins. */
export function parseSplitPoints(input: string, total: number): ParsedPoints {
  if (!total) return { points: [] };
  const parts = input
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { points: [] };
  const set = new Set<number>();
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return { points: [], error: `"${p}" isn't a page number` };
    const n = parseInt(p, 10);
    if (n < 2 || n > total) {
      return { points: [], error: `"${p}" is out of bounds (2–${total})` };
    }
    set.add(n);
  }
  return { points: Array.from(set).sort((a, b) => a - b) };
}

/** Build groups for "every N pages". */
function groupsEveryN(total: number, n: number): number[][] {
  const groups: number[][] = [];
  for (let start = 1; start <= total; start += n) {
    const end = Math.min(total, start + n - 1);
    const g: number[] = [];
    for (let i = start; i <= end; i++) g.push(i);
    groups.push(g);
  }
  return groups;
}

/** Build groups from split points (1-based pages where a new part begins). */
function groupsFromPoints(total: number, points: number[]): number[][] {
  const cuts = [1, ...points, total + 1];
  const groups: number[][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i];
    const end = cuts[i + 1] - 1;
    if (end < start) continue;
    const g: number[] = [];
    for (let p = start; p <= end; p++) g.push(p);
    groups.push(g);
  }
  return groups;
}

/**
 * Split a PDF according to options. Returns a single PDF blob (one group) or a
 * zip blob (multiple groups / every-page mode). Never mutates the input file.
 */
export async function splitPdf(file: File, opts: SplitOptions): Promise<SplitResult> {
  const src = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const base = file.name.replace(/\.pdf$/i, "");
  const total = src.getPageCount();

  // "each" stays a streaming write since it can be very large.
  if (opts.mode === "each") {
    const JSZip = (await importChunk(() => import("jszip"))).default;
    const zip = new JSZip();
    for (let i = 0; i < total; i++) {
      const out = await PDFDocument.create();
      const [p] = await out.copyPages(src, [i]);
      out.addPage(p);
      const bytes = await out.save();
      zip.file(`${base}-p${String(i + 1).padStart(3, "0")}.pdf`, bytes);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    return {
      kind: "zip",
      blob,
      filename: `${base}-pages.zip`,
      fileCount: total,
      pageCount: total,
    };
  }

  // Compute groups + output naming for the other modes.
  let groups: number[][] = [];
  let zipName = `${base}-split.zip`;
  let pdfName = `${base}-split.pdf`;

  if (opts.mode === "ranges") {
    const parsed = parseRanges(opts.ranges, total);
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.groups.length === 0) {
      throw new Error("Enter at least one valid range like 1-3, 5, 8-10");
    }
    groups = parsed.groups;
  } else if (opts.mode === "everyN") {
    const n = Math.floor(opts.n);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error("Enter a chunk size of 1 or more");
    }
    groups = groupsEveryN(total, n);
    zipName = `${base}-every-${n}.zip`;
  } else if (opts.mode === "splitPoints") {
    const parsed = parseSplitPoints(opts.points, total);
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.points.length === 0) {
      throw new Error("Enter at least one split point (e.g. 5, 12)");
    }
    groups = groupsFromPoints(total, parsed.points);
    zipName = `${base}-parts.zip`;
  }

  if (groups.length === 1) {
    const idx = groups[0].map((n) => n - 1);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, idx);
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    return {
      kind: "pdf",
      blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
      filename: pdfName,
      pageCount: idx.length,
    };
  }

  const JSZip = (await importChunk(() => import("jszip"))).default;
  const zip = new JSZip();
  let totalPages = 0;
  for (let g = 0; g < groups.length; g++) {
    const idx = groups[g].map((n) => n - 1);
    totalPages += idx.length;
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, idx);
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    zip.file(`${base}-part${g + 1}.pdf`, bytes);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return {
    kind: "zip",
    blob,
    filename: zipName,
    fileCount: groups.length,
    pageCount: totalPages,
  };
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
