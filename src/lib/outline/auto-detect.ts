/**
 * Heuristic auto-bookmark detector.
 *
 * Extracts heading candidates from a PDF's text layer via pdf.js and returns
 * a nested OutlineNode[] ready to feed to the existing outline UI + writer.
 * 100% on-device, deterministic, no AI.
 *
 * Signals (in priority order):
 *   1. Numbering pattern — "1.", "1.2", "ARTICLE III", "Section 4.1", roman.
 *   2. Font size vs. document-wide body-text median (>= 1.15x = candidate).
 *   3. Bold in font name promotes one tier.
 *   4. All-caps short lines promote one tier.
 *   5. Running header/footer detector — drop candidates that repeat on
 *      >= 60% of pages at nearly-identical (x, y).
 *
 * The final tree is capped and re-thresholded automatically to avoid
 * flooding the outline with body-text false positives.
 */
import { openPdfjs } from "@/lib/pdf/pdf-open";
import type { OutlineNode } from "./types";
import { newId } from "./types";

interface RawLine {
  pageIndex: number;
  text: string;
  x: number;
  yTop: number;        // top edge in PDF user space (origin bottom-left)
  yBase: number;       // baseline
  fontSize: number;
  fontName: string;
  pageHeight: number;
}

interface Candidate extends RawLine {
  level: number;       // 1..4
  score: number;
  patternForced: boolean;
}

export interface DetectStats {
  headings: number;
  levels: number;
  scannedPages: number;
  hasTextLayer: boolean;
}

const HEADING_PATTERNS: Array<{ re: RegExp; level: number }> = [
  { re: /^\s*(ARTICLE|CHAPTER|PART|TITLE|BOOK)\s+[\dIVXLCM]+\b/i, level: 1 },
  { re: /^\s*(APPENDIX|EXHIBIT|SCHEDULE|ANNEX|ATTACHMENT)\s+[A-Z\d]+\b/i, level: 1 },
  { re: /^\s*(SECTION)\s+\d+\.\d+\b/i, level: 2 },
  { re: /^\s*(SECTION)\s+\d+\b/i, level: 1 },
  { re: /^\s*\d+\.\d+\.\d+(\.\d+)?\s+\S/, level: 3 },
  { re: /^\s*\d+\.\d+\s+\S/, level: 2 },
  { re: /^\s*\d+\.\s+\S/, level: 1 },
  { re: /^\s*[IVXLCM]{1,6}\.\s+\S/, level: 1 },  // roman
  { re: /^\s*[A-Z]\.\s+\S/, level: 2 },
];

function classifyPattern(text: string): number | null {
  for (const p of HEADING_PATTERNS) if (p.re.test(text)) return p.level;
  return null;
}

function isBold(fontName: string): boolean {
  return /bold|black|heavy|semibold|demi/i.test(fontName);
}

function isMostlyCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.75;
}

/** Group items into visual lines (same baseline, same page). */
function groupIntoLines(
  items: Array<{ str: string; transform: number[]; height?: number; width?: number; fontName?: string }>,
  pageIndex: number,
  pageHeight: number,
): RawLine[] {
  const rows = new Map<string, { parts: typeof items; y: number; x: number; h: number; font: string }>();
  for (const it of items) {
    const str = (it.str ?? "").replace(/\s+/g, " ");
    if (!str.trim()) continue;
    const t = it.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    const size = it.height || Math.abs(t[3]) || Math.abs(t[0]) || 10;
    const y = t[5];
    const x = t[4];
    // Bucket by rounded baseline (2pt tolerance).
    const key = String(Math.round(y / 2) * 2);
    const row = rows.get(key);
    if (row) {
      row.parts.push(it);
      row.x = Math.min(row.x, x);
      row.h = Math.max(row.h, size);
      if (!row.font && it.fontName) row.font = it.fontName;
    } else {
      rows.set(key, { parts: [it], y, x, h: size, font: it.fontName ?? "" });
    }
  }
  const lines: RawLine[] = [];
  for (const row of rows.values()) {
    // Concat in x order.
    row.parts.sort((a, b) => a.transform[4] - b.transform[4]);
    const text = row.parts.map((p) => (p.str ?? "").replace(/\s+/g, " ")).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push({
      pageIndex,
      text,
      x: row.x,
      yBase: row.y,
      yTop: row.y + row.h,
      fontSize: row.h,
      fontName: row.font,
      pageHeight,
    });
  }
  return lines;
}

/** Median of a numeric array (returns 0 for empty). */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Drop candidates whose (text, x, y) recur on many pages — headers/footers. */
function dropRunningElements(lines: RawLine[], totalPages: number): RawLine[] {
  if (totalPages < 3) return lines;
  const buckets = new Map<string, Set<number>>();
  for (const l of lines) {
    const key = `${l.text.slice(0, 40)}|${Math.round(l.x / 10)}|${Math.round(l.yBase / 10)}`;
    const set = buckets.get(key) ?? new Set<number>();
    set.add(l.pageIndex);
    buckets.set(key, set);
  }
  const banned = new Set<string>();
  const threshold = Math.max(3, Math.floor(totalPages * 0.6));
  for (const [key, pages] of buckets) {
    if (pages.size >= threshold) banned.add(key);
  }
  return lines.filter((l) => {
    const key = `${l.text.slice(0, 40)}|${Math.round(l.x / 10)}|${Math.round(l.yBase / 10)}`;
    return !banned.has(key);
  });
}

function scoreLines(lines: RawLine[], bodySize: number): Candidate[] {
  const cands: Candidate[] = [];
  for (const l of lines) {
    const len = l.text.length;
    if (len < 3 || len > 160) continue;
    // Kill mid-paragraph fragments — trailing punctuation.
    if (/[,;]$/.test(l.text)) continue;

    const patternLevel = classifyPattern(l.text);
    const sizeRatio = bodySize > 0 ? l.fontSize / bodySize : 1;
    const bold = isBold(l.fontName);
    const caps = isMostlyCaps(l.text);

    // Base score
    let score = 0;
    if (patternLevel !== null) score += 60;
    if (sizeRatio >= 1.5) score += 40;
    else if (sizeRatio >= 1.25) score += 25;
    else if (sizeRatio >= 1.15) score += 12;
    if (bold) score += 15;
    if (caps && len <= 80) score += 15;
    // Prefer lines that end without a period (except numbered).
    if (!/[.:]$/.test(l.text) || patternLevel !== null) score += 5;
    // Very long lines are unlikely to be headings unless numbered.
    if (len > 100 && patternLevel === null) score -= 20;

    // Accept threshold
    if (score < 30) continue;

    // Level assignment
    let level: number;
    if (patternLevel !== null) {
      level = patternLevel;
    } else if (sizeRatio >= 1.6) level = 1;
    else if (sizeRatio >= 1.35) level = 2;
    else if (sizeRatio >= 1.2) level = 3;
    else level = 4;
    if (bold && level > 1 && patternLevel === null) level = Math.max(1, level - 1);
    if (caps && level > 1 && patternLevel === null) level = Math.max(1, level - 1);

    cands.push({
      ...l,
      level: Math.min(4, Math.max(1, level)),
      score,
      patternForced: patternLevel !== null,
    });
  }
  return cands;
}

function dedupeAdjacent(cands: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  let last: Candidate | null = null;
  for (const c of cands) {
    if (
      last &&
      last.pageIndex === c.pageIndex &&
      last.text === c.text &&
      Math.abs(last.yBase - c.yBase) < 4
    ) continue;
    out.push(c);
    last = c;
  }
  return out;
}

/** Nest a flat, page-ordered list by level into a tree. */
function nest(cands: Candidate[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: Array<{ level: number; node: OutlineNode }> = [];
  for (const c of cands) {
    const node: OutlineNode = {
      id: newId("o"),
      title: c.text.slice(0, 200),
      dest: {
        page: c.pageIndex,
        x: null,
        // Top of the heading — leaves room for the line itself.
        y: c.yTop + 2,
        zoom: null,
      },
      style: { bold: false, italic: false },
      color: null,
      expanded: c.level <= 1,
      children: [],
    };
    while (stack.length && stack[stack.length - 1].level >= c.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ level: c.level, node });
  }
  return roots;
}

export interface DetectResult {
  outline: OutlineNode[];
  stats: DetectStats;
}

export async function detectHeadings(bytes: Uint8Array): Promise<DetectResult> {
  const doc = await openPdfjs(bytes.slice(), {});
  const scannedPages = doc.numPages;
  const allLines: RawLine[] = [];
  let anyText = false;
  try {
    for (let i = 0; i < scannedPages; i++) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items as Array<{
        str: string;
        transform: number[];
        height?: number;
        width?: number;
        fontName?: string;
      }>;
      if (items.some((it) => (it.str ?? "").trim().length > 0)) anyText = true;
      const lines = groupIntoLines(items, i, vp.height);
      allLines.push(...lines);
      try { page.cleanup(); } catch { /* noop */ }
    }
  } finally {
    try { await doc.cleanup(); } catch { /* noop */ }
  }

  if (!anyText) {
    return {
      outline: [],
      stats: { headings: 0, levels: 0, scannedPages, hasTextLayer: false },
    };
  }

  const filtered = dropRunningElements(allLines, scannedPages);
  const bodySize = median(filtered.map((l) => l.fontSize));

  let cands = scoreLines(filtered, bodySize);
  cands = dedupeAdjacent(cands);
  // Sort by page then y from top to bottom.
  cands.sort((a, b) => a.pageIndex - b.pageIndex || b.yBase - a.yBase);

  // Cap: if we detected an unreasonable amount for the doc size, tighten
  // by keeping only the top-scoring lines.
  const cap = Math.max(80, scannedPages * 6);
  if (cands.length > cap) {
    cands = [...cands].sort((a, b) => b.score - a.score).slice(0, cap);
    cands.sort((a, b) => a.pageIndex - b.pageIndex || b.yBase - a.yBase);
  }

  const levels = new Set(cands.map((c) => c.level)).size;
  const outline = nest(cands);
  return {
    outline,
    stats: { headings: cands.length, levels, scannedPages, hasTextLayer: true },
  };
}
