// pdf.js TextContent → Glyph[] extraction.
//
// This module is a leaf: it depends only on pdf.js types and the pure helpers
// in transform.ts / bbox.ts. It does NOT touch the viewer, editor-canvas,
// tab lifecycle, or samplePageBg — those keep using their existing text-run
// path unchanged.

import type { Glyph, Matrix } from "./types";
import { multiply, decompose } from "./transform";
import { emBoxOriented, boxAabb } from "./bbox";

// ────────────────────────────────────────────────────────────────────
// Ligature table — deliberately narrow. Extend as PDFs demand it.
// ────────────────────────────────────────────────────────────────────
export const LIGATURES: Record<string, string[]> = {
  "\uFB00": ["f", "f"],
  "\uFB01": ["f", "i"],
  "\uFB02": ["f", "l"],
  "\uFB03": ["f", "f", "i"],
  "\uFB04": ["f", "f", "l"],
  "\uFB05": ["\u017F", "t"],
  "\uFB06": ["s", "t"],
  "\u0132": ["I", "J"],
  "\u0133": ["i", "j"],
  "\u0152": ["O", "E"],
  "\u0153": ["o", "e"],
  "\u00E6": ["a", "e"],
  "\u00C6": ["A", "E"],
};

export function decomposeLigature(ch: string): string[] {
  return LIGATURES[ch] ?? [ch];
}

// ────────────────────────────────────────────────────────────────────
// Public API (renderer-agnostic).
// ────────────────────────────────────────────────────────────────────

/** Minimal shape of a pdf.js `TextItem` we depend on. */
export interface TextItemLike {
  str: string;
  transform: Matrix;    // [a, b, c, d, e, f] — glyph space → device space
  width: number;        // in device units (includes scale)
  height: number;
  fontName: string;
  hasEOL?: boolean;
}

export interface FontMetricsLike {
  ascent?: number;      // font-units fraction of 1 (pdf.js convention)
  descent?: number;
  italicAngle?: number; // degrees
  unitsPerEm?: number;
  widths?: Record<string, number>; // per-codepoint advance
  loadedName?: string;
  fallbackName?: string;
  family?: string;
  isMonospace?: boolean;
  isSerifFont?: boolean;
  bold?: boolean;
}

export interface ExtractOptions {
  /** 0-based page index. */
  page: number;
  /** Text items in reading order (pdf.js `TextContent.items`). */
  items: TextItemLike[];
  /** Lookup for font metrics — usually via `page.commonObjs.get(fontName)`. */
  getFont: (fontName: string) => FontMetricsLike | undefined;
  /**
   * Optional page rotation (matrix pre-multiplied onto every glyph transform).
   * Defaults to identity — callers passing already-rotated text-item
   * transforms should leave this unset.
   */
  pageMatrix?: Matrix;
}

export function extractPageGlyphs(opts: ExtractOptions): Glyph[] {
  const { page, items, getFont, pageMatrix } = opts;
  const glyphs: Glyph[] = [];
  let order = 0;

  for (let runIdx = 0; runIdx < items.length; runIdx++) {
    const item = items[runIdx];
    if (!item || !item.str) continue;

    const font = getFont(item.fontName);
    const unitsPerEm = font?.unitsPerEm ?? 1000;
    const ascFrac = font?.ascent ?? 0.75;
    const descFrac = Math.abs(font?.descent ?? 0.25);

    const baseTransform: Matrix = pageMatrix
      ? multiply(pageMatrix, item.transform)
      : item.transform;
    const decomp = decompose(baseTransform);
    const fontSize = Math.abs(decomp.scaleY) || Math.abs(decomp.scaleX) || 1;
    const italic = Boolean(font?.italicAngle) || Math.abs(decomp.skewX) > 0.05;
    const fontWeight = font?.bold ? 700 : 400;

    // Walk the string as code points; drop surrogate pairs into one visible glyph.
    const chars = Array.from(item.str);
    // Total advance in device space is `item.width`; split proportionally
    // when the font ships no per-glyph widths (Type 3 / OCR'd CIDs).
    const fallbackAdvance = chars.length ? item.width / chars.length : 0;

    // Cumulative advance in glyph-local (pre-transform) units.
    let localX = 0;
    // Advance divisor turning device width back to local units.
    const localAdvanceScale = decomp.scaleX || 1;

    for (let charIdx = 0; charIdx < chars.length; charIdx++) {
      const ch = chars[charIdx];
      const cluster = decomposeLigature(ch);

      // Per-char device advance
      let deviceAdvance = fallbackAdvance;
      if (font?.widths && ch in font.widths) {
        deviceAdvance = (font.widths[ch] / unitsPerEm) * localAdvanceScale;
      }
      const localAdvance = Math.abs(localAdvanceScale)
        ? deviceAdvance / Math.abs(localAdvanceScale)
        : deviceAdvance;

      // Translate the base transform to this glyph's start.
      const glyphMatrix: Matrix = multiply(baseTransform, [1, 0, 0, 1, localX, 0]);

      const localAscent = ascFrac * (unitsPerEm / unitsPerEm); // fraction of em
      const localDescent = descFrac;
      const bbox = emBoxOriented(glyphMatrix, localAdvance, localAscent, localDescent);
      const aabb = boxAabb(bbox);
      const origin = { x: glyphMatrix[4], y: glyphMatrix[5] };

      glyphs.push({
        id: `${page}:${runIdx}:${charIdx}`,
        page,
        char: ch,
        cluster,
        runId: `${page}:${runIdx}`,
        order: order++,
        transform: glyphMatrix,
        origin,
        advance: deviceAdvance,
        ascent: ascFrac * fontSize,
        descent: descFrac * fontSize,
        bbox,
        aabb,
        rotation: decomp.rotation,
        skewX: decomp.skewX,
        fontId: font?.loadedName ?? item.fontName,
        fontFamily: font?.family,
        fontSize,
        fontWeight,
        italic,
        source: "pdf",
      });

      localX += localAdvance;
    }
  }

  return glyphs;
}
