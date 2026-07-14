// OCR → Glyph adapter. Char-level boxes preferred; word-level falls back to
// equal-advance splitting so downstream selection still hits at glyph
// granularity.

import type { Glyph, Matrix, Rect } from "./types";
import { emBoxOriented, boxAabb } from "./bbox";
import { multiply, rotation as rotMat, translation } from "./transform";

export interface OcrCharBox {
  char: string;
  /** Axis-aligned box in page units (bottom-left origin). */
  bbox: Rect;
}

export interface OcrWord {
  text: string;
  bbox: Rect;
  rotation?: number; // radians CCW
  chars?: OcrCharBox[];
  /** Generic family hint from the OCR engine ("serif" | "sans" | undefined). */
  fontHint?: "serif" | "sans" | "mono";
}

export interface OcrPageInput {
  page: number;
  words: OcrWord[];
  startOrder?: number;
}

function buildGlyph(params: {
  page: number;
  runIdx: number;
  charIdx: number;
  order: number;
  ch: string;
  box: Rect;
  rotation: number;
  fontHint?: OcrWord["fontHint"];
}): Glyph {
  const { page, runIdx, charIdx, order, ch, box, rotation, fontHint } = params;
  const fontSize = box.h;
  const ascent = fontSize * 0.8;
  const descent = fontSize * 0.2;
  const advance = box.w;
  // Local frame: origin at (box.x, box.y + descent) rotated by `rotation`.
  const originY = box.y + descent;
  const transform: Matrix = multiply(
    translation(box.x, originY),
    rotMat(rotation),
  );
  const bbox = emBoxOriented(transform, advance, ascent, descent);
  const family =
    fontHint === "serif" ? "generic-serif" :
    fontHint === "mono" ? "generic-mono" :
    "generic-sans";
  return {
    id: `${page}:ocr${runIdx}:${charIdx}`,
    page,
    char: ch,
    cluster: [ch],
    runId: `${page}:ocr${runIdx}`,
    order,
    transform,
    origin: { x: transform[4], y: transform[5] },
    advance,
    ascent,
    descent,
    bbox,
    aabb: boxAabb(bbox),
    rotation,
    skewX: 0,
    fontId: `ocr-${fontHint ?? "sans"}`,
    fontFamily: family,
    fontSize,
    fontWeight: 400,
    italic: false,
    source: "ocr",
  };
}

export function ocrPageToGlyphs(input: OcrPageInput): Glyph[] {
  const { page, words } = input;
  let order = input.startOrder ?? 0;
  const out: Glyph[] = [];
  for (let runIdx = 0; runIdx < words.length; runIdx++) {
    const w = words[runIdx];
    const rot = w.rotation ?? 0;
    if (w.chars && w.chars.length) {
      for (let ci = 0; ci < w.chars.length; ci++) {
        const c = w.chars[ci];
        out.push(buildGlyph({
          page, runIdx, charIdx: ci, order: order++,
          ch: c.char, box: c.bbox, rotation: rot, fontHint: w.fontHint,
        }));
      }
    } else {
      const chars = Array.from(w.text);
      const n = chars.length || 1;
      const advance = w.bbox.w / n;
      for (let ci = 0; ci < chars.length; ci++) {
        const box: Rect = { x: w.bbox.x + ci * advance, y: w.bbox.y, w: advance, h: w.bbox.h };
        out.push(buildGlyph({
          page, runIdx, charIdx: ci, order: order++,
          ch: chars[ci], box, rotation: rot, fontHint: w.fontHint,
        }));
      }
    }
  }
  return out;
}
