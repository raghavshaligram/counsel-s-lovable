// Convert a drag rectangle (in PDF points) plus the page's text items into
// one quad per text line that the rectangle intersects. Mimics the Acrobat
// behaviour where dragging across two lines yields two separate highlight
// rectangles instead of one fat box.

import type { Quad } from "./types";

export interface TextItemLite {
  x: number; y: number; w: number; h: number; str: string;
}

const TOKEN_BOUNDARY_RE = /[\s:;=|,]/;

function isTokenBoundary(ch: string): boolean {
  return TOKEN_BOUNDARY_RE.test(ch);
}

function expandStringSpanToToken(str: string, start: number, end: number): { start: number; end: number } {
  if (!str.length) return { start: 0, end: 0 };
  let s = Math.max(0, Math.min(start, str.length));
  let e = Math.max(s, Math.min(end, str.length));
  while (s > 0 && !isTokenBoundary(str[s - 1])) s--;
  while (e < str.length && !isTokenBoundary(str[e])) e++;
  return { start: s, end: e };
}

function tokenBoundsForHitItem(
  it: TextItemLite,
  rect: { x: number; y: number; w: number; h: number },
): { x: number; x2: number } {
  const strLen = it.str.length;
  if (!strLen || it.w <= 0) return { x: it.x, x2: it.x + it.w };

  const rx2 = rect.x + rect.w;
  const charW = it.w / strLen;
  const overlapStartX = Math.max(rect.x, it.x);
  const overlapEndX = Math.min(rx2, it.x + it.w);
  const rawStart = Math.floor((overlapStartX - it.x) / charW);
  const rawEnd = Math.ceil((overlapEndX - it.x) / charW);
  const expanded = expandStringSpanToToken(it.str, rawStart, rawEnd);

  return {
    x: it.x + expanded.start * charW,
    x2: it.x + expanded.end * charW,
  };
}

/**
 * Token expansion — the core defence against the "fragmented number" leak.
 *
 * pdf.js routinely splits a single visible token ("(763) 300-1828",
 * "0781151140428") into 2–5 adjacent text items whenever kerning, font
 * changes, or ToUnicode gaps interrupt the run. A drag rect (or a regex
 * match on the middle fragment) may only include one of those items, so
 * the burn covers the middle and leaves leading/trailing digits visible
 * AND extractable — a real leak, not a rasterization artefact.
 *
 * Given the current line's hit range, walk outward through same-line
 * neighbours and include any item that is CONTIGUOUS with the previous:
 *   - on the same y-band (≤ 0.6 × font height apart)
 *   - separated by ≤ ~0.5 × font height of horizontal whitespace
 *   - neither side of the join carries whitespace in its string
 * Stop at whitespace or a bigger gap so we don't bleed into the next word.
 */
function expandToken(
  line: TextItemLite[],
  allItems: TextItemLite[],
  x: number,
  x2: number,
  y: number,
  h: number,
): { x: number; x2: number } {
  // Same-line items sorted by x, so we can walk left/right deterministically
  // regardless of the order pdf.js emitted them.
  const yBand = h * 0.6;
  const sameLine = allItems
    .filter((it) => Math.abs(it.y - y) < yBand)
    .slice()
    .sort((a, b) => a.x - b.x);

  // Track the leftmost / rightmost hit's edges. The hits themselves may not
  // sit exactly on x/x2 because computeQuads clamps to the drag rect, so
  // rediscover them here for the expansion check.
  const hitSet = new Set(line);
  let leftHit: TextItemLite | null = null;
  let rightHit: TextItemLite | null = null;
  for (const it of sameLine) {
    if (!hitSet.has(it)) continue;
    if (!leftHit || it.x < leftHit.x) leftHit = it;
    if (!rightHit || it.x + it.w > rightHit.x + rightHit.w) rightHit = it;
  }
  if (!leftHit || !rightHit) return { x, x2 };

  const MAX_GAP = h * 0.5;
  // Reported text-item boxes can overlap a little at font/kerning boundaries.
  // A hard `gap < -1` cutoff made expansion stop at the second fragment,
  // leaving the first digit/letter visible. Allow modest overlap as the same
  // token; whitespace and large positive/negative gaps still stop expansion.
  const MAX_OVERLAP = h * 0.5;

  // Walk left from leftHit.
  let curL = leftHit;
  let newX = x;
  while (true) {
    if (/^\s/.test(curL.str)) break; // left side of current already whitespace
    const idx = sameLine.indexOf(curL);
    if (idx <= 0) break;
    const prev = sameLine[idx - 1];
    const gap = curL.x - (prev.x + prev.w);
    if (gap < -MAX_OVERLAP || gap > MAX_GAP) break;
    if (/\s$/.test(prev.str)) break; // previous's right side is whitespace
    newX = Math.min(newX, prev.x);
    curL = prev;
  }

  // Walk right from rightHit.
  let curR = rightHit;
  let newX2 = x2;
  while (true) {
    if (/\s$/.test(curR.str)) break;
    const idx = sameLine.indexOf(curR);
    if (idx < 0 || idx >= sameLine.length - 1) break;
    const next = sameLine[idx + 1];
    const gap = next.x - (curR.x + curR.w);
    if (gap < -MAX_OVERLAP || gap > MAX_GAP) break;
    if (/^\s/.test(next.str)) break;
    newX2 = Math.max(newX2, next.x + next.w);
    curR = next;
  }

  return { x: newX, x2: newX2 };
}

export function computeQuads(
  rect: { x: number; y: number; w: number; h: number },
  items: TextItemLite[],
): Quad[] {
  const hits: TextItemLite[] = [];
  const rx2 = rect.x + rect.w, ry2 = rect.y + rect.h;
  for (const it of items) {
    const ix2 = it.x + it.w, iy2 = it.y + it.h;
    // require >40% horizontal overlap with the item OR drag to cover most of it
    const overlapX = Math.max(0, Math.min(rx2, ix2) - Math.max(rect.x, it.x));
    const overlapY = Math.max(0, Math.min(ry2, iy2) - Math.max(rect.y, it.y));
    if (overlapX > 1 && overlapY > it.h * 0.35) hits.push(it);
  }
  if (!hits.length) return [];

  // Group items into lines by y-band (within half a glyph height).
  hits.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextItemLite[][] = [];
  for (const it of hits) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - it.y) < it.h * 0.6) line.push(it);
    else lines.push([it]);
  }

  return lines.map((line) => {
    const tokenBounds = line.map((l) => tokenBoundsForHitItem(l, rect));
    let x = Math.min(...tokenBounds.map((l) => l.x));
    let x2 = Math.max(...tokenBounds.map((l) => l.x2));
    const y = Math.min(...line.map((l) => l.y));
    const h = Math.max(...line.map((l) => l.h));

    // Token expansion: extend x/x2 across contiguous adjacent fragments so
    // a drag that only comfortably covered the middle of a fragmented value
    // still redacts the whole token. Explicitly ignores the drag rect's
    // horizontal bounds — the intent is "redact the token I hit", not
    // "redact exactly what I dragged".
    const expanded = expandToken(line, items, x, x2, y, h);
    x = expanded.x;
    x2 = expanded.x2;

    // pdf.js reports a text-run height close to the font's x-height / EM
    // advance, not the full glyph bounding box. Digits and capitals extend
    // above that band (ascender) and glyphs like 3/5/7/9/g/p/y drop below
    // (descender), so a rect built from raw item metrics leaves visible
    // slivers of the original text after burn. Pad the quad to the glyph
    // bbox: ~35% of h above, ~25% below, plus a tiny horizontal cushion
    // for italic slant / wide numerals. The burn rasterizer clamps to page
    // bounds, so over-shooting the page edge is safe.
    const padTop = h * 0.35;
    const padBottom = h * 0.25;
    const padX = Math.min(1.5, h * 0.12);
    const px = x - padX;
    const pw = Math.max(2, x2 - x + padX * 2);
    const py = y - padTop;
    const ph = h + padTop + padBottom;
    return { x: px, y: py, w: pw, h: ph };
  });
}
