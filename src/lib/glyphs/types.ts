// Glyph-based selection engine — type definitions.
// Everything here is framework-agnostic; consumers convert to renderer-specific
// coordinates at the edges (canvas, SVG, DOM overlay).

export type Matrix = [number, number, number, number, number, number];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
}

/** Four corners in reading order: top-left, top-right, bottom-right, bottom-left. */
export interface OrientedBox {
  corners: [Point, Point, Point, Point];
}

export type GlyphSource = "pdf" | "ocr";

export interface Glyph {
  /** Stable within a page: `${page}:${runIdx}:${charIdx}`. */
  id: string;
  page: number;
  /** Displayed character. For ligatures this is the ligature codepoint. */
  char: string;
  /** Decomposed characters — `["f","i"]` for `ﬁ`. Single-char for non-ligatures. */
  cluster: string[];
  /** pdf.js text-item / OCR word id, used to preserve source order. */
  runId: string;
  /** Monotonic reading order within the page. */
  order: number;

  // Geometry — PDF user space (points, bottom-left origin) unless a caller
  // rebases into another frame.
  transform: Matrix;
  origin: Point;
  advance: number;
  ascent: number;
  descent: number;
  bbox: OrientedBox;
  aabb: Rect;
  rotation: number; // radians
  skewX: number;    // radians

  // Typography
  fontId: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color?: Color;

  source: GlyphSource;
}

export interface GlyphRun {
  fontId: string;
  glyphs: Glyph[];
}

export interface Word {
  glyphs: Glyph[];
  text: string;
  aabb: Rect;
  softHyphenated?: boolean;
  /** Index of the word this one continues into (soft-hyphen line wrap). */
  continues?: number;
}

export interface SelectionRange {
  page: number;
  anchorId: string;
  focusId: string;
}

export interface HitOptions {
  /** Extra tolerance (page units) around glyph bboxes for coarse picking. */
  tolerance?: number;
}
