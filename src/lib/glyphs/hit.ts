// Glyph-level hit testing. No rectangles-of-words anywhere.

import type { Glyph, HitOptions, Point, Rect, SelectionRange } from "./types";
import { orientedBoxIntersectsRect, pointInOrientedBox, rectIntersectsRect } from "./transform";

function aabbContainsPoint(r: Rect, p: Point, tol: number): boolean {
  return p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol;
}

export function glyphAtPoint(
  glyphs: Glyph[],
  p: Point,
  opts: HitOptions = {},
): Glyph | null {
  const tol = opts.tolerance ?? 0;
  let best: Glyph | null = null;
  for (const g of glyphs) {
    if (!aabbContainsPoint(g.aabb, p, tol)) continue;
    if (!pointInOrientedBox(p, g.bbox)) continue;
    if (!best || g.order > best.order) best = g;
  }
  return best;
}

export function glyphsInRect(glyphs: Glyph[], rect: Rect): Glyph[] {
  const hits: Glyph[] = [];
  for (const g of glyphs) {
    if (!rectIntersectsRect(g.aabb, rect)) continue;
    if (!orientedBoxIntersectsRect(g.bbox, rect)) continue;
    hits.push(g);
  }
  hits.sort((a, b) => a.order - b.order);
  return hits;
}

export function rangeBetween(
  glyphs: Glyph[],
  anchorId: string,
  focusId: string,
): Glyph[] {
  const byId = new Map(glyphs.map((g) => [g.id, g] as const));
  const a = byId.get(anchorId);
  const f = byId.get(focusId);
  if (!a || !f) return [];
  const lo = Math.min(a.order, f.order);
  const hi = Math.max(a.order, f.order);
  return glyphs.filter((g) => g.order >= lo && g.order <= hi).sort((x, y) => x.order - y.order);
}

export function rangeFromSelection(glyphs: Glyph[], sel: SelectionRange): Glyph[] {
  return rangeBetween(glyphs, sel.anchorId, sel.focusId);
}

/** Pick the caret slot nearest `p` — returns the glyph and which side. */
export function caretNearest(
  glyphs: Glyph[],
  p: Point,
): { glyph: Glyph; side: "before" | "after" } | null {
  if (!glyphs.length) return null;
  let best: { glyph: Glyph; dist: number } | null = null;
  for (const g of glyphs) {
    const dx = p.x - g.origin.x;
    const dy = p.y - g.origin.y;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.dist) best = { glyph: g, dist: d };
  }
  if (!best) return null;
  const g = best.glyph;
  // Project the click onto the glyph's local x axis.
  const cos = Math.cos(-g.rotation);
  const sin = Math.sin(-g.rotation);
  const localDx = cos * (p.x - g.origin.x) + sin * (p.y - g.origin.y);
  const side: "before" | "after" = localDx > g.advance * 0.5 ? "after" : "before";
  return { glyph: g, side };
}
