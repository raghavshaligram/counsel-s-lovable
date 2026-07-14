// Display-only word grouping. Selection and highlights never call this.

import type { Glyph, Word } from "./types";
import { hullOfRects } from "./bbox";

const WS_RE = /^\s+$/;
const SOFT_HYPHEN = "\u00AD";

function baselineLocalY(g: Glyph): number {
  // Project the glyph origin onto the axis perpendicular to the run direction.
  const cos = Math.cos(-g.rotation);
  const sin = Math.sin(-g.rotation);
  return -sin * g.origin.x + cos * g.origin.y;
}

function baselineLocalX(g: Glyph): number {
  const cos = Math.cos(-g.rotation);
  const sin = Math.sin(-g.rotation);
  return cos * g.origin.x + sin * g.origin.y;
}

export function groupWords(glyphs: Glyph[]): Word[] {
  if (!glyphs.length) return [];
  const sorted = glyphs.slice().sort((a, b) => a.order - b.order);
  const words: Word[] = [];
  let current: Glyph[] = [];
  let prev: Glyph | null = null;

  const flush = (soft: boolean) => {
    if (!current.length) return;
    const text = current.flatMap((g) => g.cluster).join("");
    words.push({
      glyphs: current,
      text,
      aabb: hullOfRects(current.map((g) => g.aabb)),
      softHyphenated: soft || undefined,
    });
    current = [];
  };

  for (const g of sorted) {
    if (WS_RE.test(g.char)) {
      flush(false);
      prev = g;
      continue;
    }
    if (prev) {
      const sameRotation = Math.abs(prev.rotation - g.rotation) < 0.02;
      const sameLine =
        sameRotation && Math.abs(baselineLocalY(prev) - baselineLocalY(g)) < 0.4 * g.fontSize;
      if (!sameLine) {
        // Line break — check the previous glyph for soft-hyphen / trailing '-'.
        const lastChar = current[current.length - 1]?.char;
        const softBreak = lastChar === SOFT_HYPHEN || lastChar === "-";
        if (softBreak && current.length) {
          // Drop the hyphen from the visible text; keep glyphs so highlights
          // still cover it. Mark the next word as continuation.
          flush(true);
        } else {
          flush(false);
        }
      } else {
        const gap = baselineLocalX(g) - (baselineLocalX(prev) + prev.advance);
        if (gap > 0.25 * g.fontSize) flush(false);
      }
    }
    current.push(g);
    prev = g;
  }
  flush(false);

  // Link soft-hyphenated words to their continuation index.
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].softHyphenated) words[i].continues = i + 1;
  }
  return words;
}
