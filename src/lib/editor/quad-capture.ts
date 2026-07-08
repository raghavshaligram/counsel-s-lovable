// Convert a drag rectangle (in PDF points) plus the page's text items into
// one quad per text line that the rectangle intersects. Mimics the Acrobat
// behaviour where dragging across two lines yields two separate highlight
// rectangles instead of one fat box.

import type { Quad } from "./types";

export interface TextItemLite {
  x: number; y: number; w: number; h: number; str: string;
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
    const x = Math.max(rect.x, Math.min(...line.map((l) => l.x)));
    const x2 = Math.min(rx2, Math.max(...line.map((l) => l.x + l.w)));
    const y = Math.min(...line.map((l) => l.y));
    const h = Math.max(...line.map((l) => l.h));
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
