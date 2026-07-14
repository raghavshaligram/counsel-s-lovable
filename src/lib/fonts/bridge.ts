// Bridge between the new FontResolver (src/lib/fonts/resolver.ts) and the
// editor's bundled metric-compatible font set (src/lib/editor/fonts.ts).
//
// The resolver returns a rich CanonicalFont describing the source PDF's
// intended typeface. The editor overlay + export pipeline can only embed
// one of five keys — Carlito / Arimo / Tinos / Caladea / Cousine — so this
// module picks the closest FontKey for a given resolver result and hands
// back a shape that is a drop-in replacement for both detectFontKey() and
// matchPdfFont() at their edit-text call sites in editor-canvas.tsx.
//
// Nothing else in the app depends on this file; existing detectFontKey /
// matchPdfFont consumers (detect-pii.ts, /editor route) are untouched.

import { FONT_KEYS, FONT_META, type FontKey } from "@/lib/editor/fonts";
import { resolveFont } from "./resolver";
import type { CanonicalFont, FontKind, FontQuery, ResolveResult } from "./types";

const KIND_TO_KEY: Record<FontKind, FontKey> = {
  sans: "arimo",
  serif: "tinos",
  mono: "cousine",
  display: "arimo",
};

function pickKey(font: CanonicalFont): FontKey {
  if (font.metricTwin && (FONT_KEYS as string[]).includes(font.metricTwin)) {
    return font.metricTwin as FontKey;
  }
  return KIND_TO_KEY[font.kind];
}

export interface BridgeResult {
  /** Metric-compatible embedded font used by the export pipeline. */
  key: FontKey;
  /** CSS stack for the overlay — prepends the bundled Vault* face so the
   *  browser paints the real metric twin, then falls back through the
   *  canonical stack, then to a generic. */
  fontFamily: string;
  /** Numeric weight (100..900). */
  fontWeight: number;
  fontStyle: "italic" | "normal";
  /** True when the resolver hit an exact family (not a generic fallback). */
  matched: boolean;
  /** True when the FontKey chosen is only an approximate twin
   *  (e.g. Garamond → Tinos), not a metric-compatible one. */
  approximate: boolean;
  bold: boolean;
  italic: boolean;
  weight: number;
  /** Full resolver result for diagnostics / future wiring. */
  resolved: ResolveResult;
}

export function resolveToFontKey(q: FontQuery): BridgeResult {
  const r = resolveFont(q);
  const key = pickKey(r.font);
  const meta = FONT_META[key];
  const twinName = meta.cssFamily.split(",")[0].trim();
  const approximate = r.font.metricTwin
    ? !(FONT_KEYS as string[]).includes(r.font.metricTwin)
    : true;
  return {
    key,
    fontFamily: `${twinName}, ${r.font.cssStack}`,
    fontWeight: r.weight,
    fontStyle: r.italic ? "italic" : "normal",
    matched: r.exact,
    approximate: !r.exact || approximate,
    bold: r.bold,
    italic: r.italic,
    weight: r.weight,
    resolved: r,
  };
}
