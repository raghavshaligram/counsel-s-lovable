// Selection → oriented highlight quads. This is the ONLY place highlight
// geometry is produced.

import type { Glyph, OrientedBox, Point, SelectionRange } from "./types";
import { apply } from "./transform";
import { rangeFromSelection } from "./hit";

interface Bucket {
  rotation: number;
  baselineY: number; // local (rotated) y
  fontSize: number;
  glyphs: Glyph[];
}

function localX(g: Glyph): number {
  const cos = Math.cos(-g.rotation);
  const sin = Math.sin(-g.rotation);
  return cos * g.origin.x + sin * g.origin.y;
}

function localY(g: Glyph): number {
  const cos = Math.cos(-g.rotation);
  const sin = Math.sin(-g.rotation);
  return -sin * g.origin.x + cos * g.origin.y;
}

export function selectionQuads(
  glyphs: Glyph[],
  range: SelectionRange,
): OrientedBox[] {
  const slice = rangeFromSelection(glyphs, range);
  if (!slice.length) return [];
  const buckets: Bucket[] = [];
  for (const g of slice) {
    const by = localY(g);
    const b = buckets.find(
      (bk) =>
        Math.abs(bk.rotation - g.rotation) < 0.02 &&
        Math.abs(bk.baselineY - by) < 0.3 * g.fontSize,
    );
    if (b) b.glyphs.push(g);
    else buckets.push({ rotation: g.rotation, baselineY: by, fontSize: g.fontSize, glyphs: [g] });
  }

  const out: OrientedBox[] = [];
  for (const bk of buckets) {
    bk.glyphs.sort((a, b) => localX(a) - localX(b));
    const first = bk.glyphs[0];
    const last = bk.glyphs[bk.glyphs.length - 1];
    const ascent = Math.max(...bk.glyphs.map((g) => g.ascent));
    const descent = Math.max(...bk.glyphs.map((g) => g.descent));
    // Build the oriented quad in the run's local frame, then rotate back.
    const cos = Math.cos(bk.rotation);
    const sin = Math.sin(bk.rotation);
    const x0 = localX(first);
    const x1 = localX(last) + last.advance;
    const y = bk.baselineY;
    const localCorners: Point[] = [
      { x: x0, y: y + ascent },   // TL
      { x: x1, y: y + ascent },   // TR
      { x: x1, y: y - descent },  // BR
      { x: x0, y: y - descent },  // BL
    ];
    const corners = localCorners.map((p) => ({
      x: cos * p.x - sin * p.y,
      y: sin * p.x + cos * p.y,
    })) as [Point, Point, Point, Point];
    out.push({ corners });
  }
  return out;
}

/** Explicit no-op re-export so callers see `apply` is the shared math. */
export const _applyForTests = apply;
