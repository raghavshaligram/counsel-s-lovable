/**
 * Remove baked-in Bates stamps.
 *
 * The Bates panel already stamps at export time — this is the reverse pass,
 * for PDFs that arrived from another tool with Bates already burned into the
 * page content. We:
 *
 *   1. Scan the pdf.js text layer of every page.
 *   2. Match short runs against the user-supplied format
 *      (prefix + digits + suffix), gated by the chosen corner region so we
 *      don't cover page numbers in the header.
 *   3. Cover each match with an opaque white rectangle via pdf-lib.
 *
 * Purely lossless for anything outside the stamp bbox.
 */
import { PDFDocument, rgb } from "pdf-lib";
import { openPdfjs } from "@/lib/pdf/pdf-open";

export type BatesCorner = "tl" | "tc" | "tr" | "bl" | "bc" | "br";

export interface BatesRemoveFormat {
  prefix: string;
  suffix: string;
  digits: number;
  corner: BatesCorner;
}

export interface BatesMatch {
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface BatesAutoDetection {
  matches: BatesMatch[];
  format: BatesRemoveFormat | null;
  pagesWithText: number;
  totalPages: number;
}

type TextItem = { str: string; transform: number[]; width: number; height: number };
type Piece = TextItem & { x: number; y: number };
type TextLine = { pageIndex: number; pageW: number; pageH: number; items: Piece[]; text: string };
type BatesCandidate = BatesMatch & {
  prefix: string;
  suffix: string;
  digits: number;
  corner: BatesCorner;
  number: number;
};

const SEP = "[\\s._\\-–—]*";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flexibleLiteral(s: string): string {
  return Array.from(s).map((ch) => {
    if (/\s|[._\-–—]/.test(ch)) return SEP;
    return escapeRegExp(ch);
  }).join("");
}

function buildPattern(f: BatesRemoveFormat): RegExp {
  const min = Math.max(1, f.digits - 2);
  const max = f.digits + 2;
  // Global, case-insensitive — allow the stamp anywhere in the joined line
  // (pdf.js frequently splits "ABC000123" into "ABC" + "000123" items and
  // may include neighbouring page-number/header text on the same baseline).
  return new RegExp(
    `${flexibleLiteral(f.prefix ?? "")}${SEP}\\d(?:${SEP}\\d){${min - 1},${max - 1}}${SEP}${flexibleLiteral(f.suffix ?? "")}`,
    "gi",
  );
}

/** True when the glyph bbox falls in the chosen corner region of the page. */
function inCorner(
  corner: BatesCorner,
  x: number,
  y: number,
  pageW: number,
  pageH: number,
): boolean {
  // Widened bands — real stamps sometimes sit ~20% from the edge, not 15%.
  const top = y >= pageH * 0.78;
  const bottom = y <= pageH * 0.22;
  const left = x <= pageW * 0.45;
  const right = x >= pageW * 0.5;
  const center = x > pageW * 0.15 && x < pageW * 0.85;
  switch (corner) {
    case "tl": return top && left;
    case "tc": return top && center;
    case "tr": return top && right;
    case "bl": return bottom && left;
    case "bc": return bottom && center;
    case "br": return bottom && right;
  }
}

function cornerFromBounds(x: number, y: number, w: number, pageW: number, pageH: number): BatesCorner | null {
  const cx = x + w / 2;
  const top = y >= pageH * 0.65;
  const bottom = y <= pageH * 0.35;
  if (!top && !bottom) return null;
  const col = cx <= pageW * 0.4 ? "l" : cx >= pageW * 0.6 ? "r" : "c";
  return `${top ? "t" : "b"}${col}` as BatesCorner;
}

function boundsForRange(items: Piece[], start: number, end: number): Omit<BatesMatch, "pageIndex" | "text"> | null {
  let cursor = 0;
  let bx = Infinity;
  let by = Infinity;
  let bxEnd = -Infinity;
  let bh = 0;
  for (const it of items) {
    const s = cursor;
    const e = cursor + it.str.length;
    cursor = e;
    if (e <= start || s >= end) continue;
    const iw = it.width || Math.max(4, it.str.length * Math.abs(it.transform[0] || 6) * 0.5);
    const ih = it.height || Math.abs(it.transform[3]) || 10;
    const len = Math.max(1, it.str.length);
    const overlapStart = Math.max(start, s);
    const overlapEnd = Math.min(end, e);
    const ix = it.x + iw * ((overlapStart - s) / len);
    const ixEnd = it.x + iw * ((overlapEnd - s) / len);
    bx = Math.min(bx, ix);
    by = Math.min(by, it.y);
    bxEnd = Math.max(bxEnd, ixEnd);
    bh = Math.max(bh, ih);
  }
  if (!isFinite(bx) || !isFinite(by)) return null;
  return {
    x: bx,
    y: by - bh * 0.2,
    w: Math.max(bxEnd - bx, bh * 0.5),
    h: bh * 1.4,
  };
}

async function scanTextLines(
  bytes: Uint8Array,
  onLine: (line: TextLine) => void,
): Promise<{ pagesWithText: number; totalPages: number }> {
  const doc = await openPdfjs(bytes.slice(), {});
  let pagesWithText = 0;
  try {
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      // Collect all pieces, then greedily bucket by baseline with a 3px
      // tolerance so split runs like ["CPDF-","000001"] end up on one line.
      const pieces: Piece[] = [];
      for (const raw of content.items as unknown[]) {
        const it = raw as TextItem;
        if (!it.str) continue;
        const t = it.transform;
        if (!Array.isArray(t) || t.length < 6) continue;
        pieces.push({ ...it, x: t[4], y: t[5] });
      }
      if (pieces.length > 0) pagesWithText += 1;
      pieces.sort((a, b) => b.y - a.y);
      const lines: Piece[][] = [];
      const Y_TOL = 3;
      for (const p of pieces) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last[0].y - p.y) <= Y_TOL) last.push(p);
        else lines.push([p]);
      }
      for (const items of lines) {
        items.sort((a, b) => a.x - b.x);
        onLine({ pageIndex: i, pageW: vp.width, pageH: vp.height, items, text: items.map((it) => it.str).join("") });
      }
      try { page.cleanup(); } catch { /* noop */ }
    }
  } finally {
    try { await doc.cleanup(); } catch { /* noop */ }
  }
  return { pagesWithText, totalPages: doc.numPages };
}

function inferCandidateFormat(text: string): Pick<BatesCandidate, "prefix" | "suffix" | "digits" | "number"> | null {
  const compact = text.trim().replace(/[–—]/g, "-").replace(/\s+/g, "");
  if (compact.length < 4 || compact.length > 36) return null;
  const firstDigit = compact.search(/\d/);
  const lastDigit = Math.max(compact.lastIndexOf("0"), compact.lastIndexOf("1"), compact.lastIndexOf("2"), compact.lastIndexOf("3"), compact.lastIndexOf("4"), compact.lastIndexOf("5"), compact.lastIndexOf("6"), compact.lastIndexOf("7"), compact.lastIndexOf("8"), compact.lastIndexOf("9"));
  if (firstDigit < 0 || lastDigit < firstDigit) return null;
  const prefix = compact.slice(0, firstDigit);
  const digitPart = compact.slice(firstDigit, lastDigit + 1).replace(/\D/g, "");
  const suffix = compact.slice(lastDigit + 1);
  const hasAlphaAffix = /[a-z]/i.test(prefix) || /[a-z]/i.test(suffix);
  const hasBatesLikeNumber = digitPart.length >= 5 && digitPart.startsWith("0");
  if (digitPart.length < 4 || (!hasAlphaAffix && !hasBatesLikeNumber)) return null;
  return { prefix, suffix, digits: digitPart.length, number: Number(digitPart) };
}

function scoreCandidates(candidates: BatesCandidate[], totalPages: number): number {
  const pages = new Set(candidates.map((c) => c.pageIndex));
  const sorted = [...candidates].sort((a, b) => a.pageIndex - b.pageIndex || a.number - b.number);
  let sequentialPairs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const pageDelta = sorted[i].pageIndex - sorted[i - 1].pageIndex;
    const numberDelta = sorted[i].number - sorted[i - 1].number;
    if (pageDelta > 0 && numberDelta === pageDelta) sequentialPairs += 1;
  }
  const sample = candidates[0];
  const alphaAffix = /[a-z]/i.test(sample.prefix) || /[a-z]/i.test(sample.suffix);
  const coverage = totalPages <= 1 ? candidates.length : pages.size / Math.max(1, totalPages);
  return (
    pages.size * 20 +
    candidates.length * 4 +
    sequentialPairs * 18 +
    coverage * 12 +
    (alphaAffix ? 14 : 0) +
    Math.min(sample.digits, 8)
  );
}

export async function findBatesStamps(
  bytes: Uint8Array,
  format: BatesRemoveFormat,
): Promise<BatesMatch[]> {
  const pattern = buildPattern(format);
  const out: BatesMatch[] = [];
  await scanTextLines(bytes, (line) => {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line.text)) !== null) {
      const box = boundsForRange(line.items, m.index, m.index + m[0].length);
      if (!box) continue;
      if (!inCorner(format.corner, box.x + box.w / 2, box.y + box.h / 2, line.pageW, line.pageH)) continue;
      out.push({ pageIndex: line.pageIndex, ...box, text: m[0] });
    }
  });
  return out;
}

export async function findBatesStampsAuto(bytes: Uint8Array): Promise<BatesAutoDetection> {
  const candidates: BatesCandidate[] = [];
  const autoPattern = /[A-Z][A-Z0-9]{0,15}(?:[\s._\-–—]*\d){4,10}(?:[\s._\-–—]*[A-Z]{1,8})?|(?:\d[\s._\-–—]*){5,10}(?:[A-Z]{1,8})?/gi;
  const stats = await scanTextLines(bytes, (line) => {
    autoPattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = autoPattern.exec(line.text)) !== null) {
      const inferred = inferCandidateFormat(m[0]);
      if (!inferred) continue;
      const box = boundsForRange(line.items, m.index, m.index + m[0].length);
      if (!box) continue;
      const detectedCorner = cornerFromBounds(box.x, box.y + box.h / 2, box.w, line.pageW, line.pageH);
      if (!detectedCorner) continue;
      candidates.push({
        pageIndex: line.pageIndex,
        ...box,
        text: m[0],
        ...inferred,
        corner: detectedCorner,
      });
    }
  });

  if (candidates.length === 0) {
    return { matches: [], format: null, ...stats };
  }

  const groups = new Map<string, BatesCandidate[]>();
  for (const c of candidates) {
    const key = `${c.prefix}\u0000${c.suffix}\u0000${c.digits}\u0000${c.corner}`;
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }

  let best: BatesCandidate[] = [];
  let bestScore = -Infinity;
  for (const group of groups.values()) {
    const score = scoreCandidates(group, stats.totalPages);
    if (score > bestScore) {
      bestScore = score;
      best = group;
    }
  }
  const first = best[0];
  if (!first) return { matches: [], format: null, ...stats };
  return {
    matches: best.map(({ prefix: _prefix, suffix: _suffix, digits: _digits, corner: _corner, number: _number, ...match }) => match),
    format: {
      prefix: first.prefix,
      suffix: first.suffix,
      digits: first.digits,
      corner: first.corner,
    },
    ...stats,
  };
}

export async function removeBatesStamps(
  bytes: Uint8Array,
  matches: BatesMatch[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const m of matches) {
    const page = pages[m.pageIndex];
    if (!page) continue;
    page.drawRectangle({
      x: m.x - 1,
      y: m.y - 1,
      width: m.w + 2,
      height: m.h + 2,
      color: rgb(1, 1, 1),
    });
  }
  return await doc.save({ useObjectStreams: true });
}
