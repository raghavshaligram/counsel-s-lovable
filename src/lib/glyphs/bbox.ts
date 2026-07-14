// Oriented + axis-aligned box helpers used by extraction, hit tests, and quads.

import type { Matrix, OrientedBox, Point, Rect } from "./types";
import { apply, orientedAabb } from "./transform";

/**
 * Build a glyph oriented bbox by transforming the local EM-box corners by the
 * glyph matrix. Local box uses `(0, -descent)` … `(advance, ascent)`.
 *
 * Corners are returned in reading order (TL, TR, BR, BL) in **page** space
 * where +y is up (PDF convention). Callers that render top-down flip y at
 * the edge.
 */
export function emBoxOriented(
  m: Matrix,
  advance: number,
  ascent: number,
  descent: number,
): OrientedBox {
  const tl: Point = apply(m, { x: 0, y: ascent });
  const tr: Point = apply(m, { x: advance, y: ascent });
  const br: Point = apply(m, { x: advance, y: -descent });
  const bl: Point = apply(m, { x: 0, y: -descent });
  return { corners: [tl, tr, br, bl] };
}

export function boxAabb(box: OrientedBox): Rect {
  return orientedAabb(box);
}

export function hullOfRects(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function hullOfBoxes(boxes: OrientedBox[]): Rect {
  return hullOfRects(boxes.map(boxAabb));
}
