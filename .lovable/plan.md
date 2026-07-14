
## Goal

Ship a standalone **glyph-based selection engine** that replaces text-run/word hit testing. Every glyph gets its own record (bbox, transform, baseline, font, rotation, page); words are computed only for display. Selection, hit testing, and highlight quads always operate at glyph level.

Explicitly out of scope this turn: `editor-canvas.tsx`, the PDF viewer, tab / open lifecycle, `samplePageBg`, and `quad-capture.ts`. The current text-run path keeps working untouched — the new engine ships alongside, ready to be adopted later.

## Deliverables

New files only:

```text
src/lib/glyphs/
  types.ts          # Glyph, GlyphRun, Word, SelectionRange, HitOptions
  extract.ts        # pdf.js TextContent → Glyph[] per page
  transform.ts      # 6-tuple matrix math (multiply, invert, apply, decompose)
  bbox.ts           # oriented (rotated/skewed) bbox + axis-aligned hull
  words.ts          # display-only glyph → word grouping (ligatures, hyphens)
  hit.ts            # point / rect / range hit testing at glyph level
  quads.ts          # selection → oriented quads for highlights
  ocr.ts            # adapter: OCR word/char boxes → Glyph[]
  index.ts          # barrel
tests/glyphs/
  transform.test.ts
  bbox.test.ts
  words.test.ts     # ligature + hyphenation grouping
  hit.test.ts       # point-in-rotated-glyph, rect selection across lines
  quads.test.ts     # oriented quads, multi-line, rotated page
  ocr.test.ts
```

## Data model (`types.ts`)

```ts
// 2D affine matrix in pdf.js order: [a, b, c, d, e, f]
export type Matrix = [number, number, number, number, number, number];

export interface Glyph {
  id: string;                 // stable within a page: `${pageIndex}:${runIdx}:${charIdx}`
  page: number;               // 0-based
  char: string;               // single Unicode code point OR a ligature cluster
  cluster: string[];          // decomposed characters (["f","i"] for "ﬁ")
  runId: string;              // pdf.js text-item id — used to preserve source order
  order: number;              // reading order within the page
  // Geometry — everything in PDF user space (points, bottom-left origin)
  transform: Matrix;          // full glyph transform including rotation/skew
  origin: { x: number; y: number };  // baseline start
  advance: number;            // horizontal advance in glyph-local units
  ascent: number;             // above baseline (font units → points)
  descent: number;            // below baseline
  bbox: OrientedBox;          // rotated quad, always tight to the glyph
  aabb: { x: number; y: number; w: number; h: number }; // axis-aligned hull, for coarse tests
  rotation: number;           // radians, CCW, from transform decomposition
  skewX: number;              // radians
  // Typography
  fontId: string;             // pdf.js loadedName ("g_d0_f1")
  fontFamily?: string;        // resolved via @/lib/fonts
  fontSize: number;           // in points
  fontWeight: number;
  italic: boolean;
  color?: { r: number; g: number; b: number };
  // Source flag
  source: "pdf" | "ocr";
}

export interface OrientedBox {
  // Four corners in reading order (TL, TR, BR, BL) in page coordinates.
  corners: [Point, Point, Point, Point];
}

export interface GlyphRun { fontId: string; glyphs: Glyph[]; }

export interface Word {
  glyphs: Glyph[];            // display grouping only
  text: string;               // reconstructed with ligature decomposition
  aabb: { x: number; y: number; w: number; h: number };
  softHyphenated?: boolean;   // continues on next line
}

export interface SelectionRange {
  page: number;
  anchorId: string;           // glyph id
  focusId: string;
}
```

## Extraction (`extract.ts`)

Signature: `extractPageGlyphs(page: PDFPageProxy, opts?): Promise<Glyph[]>`.

Steps:

1. Call `page.getTextContent({ includeMarkedContent: true, disableNormalization: true })`. Marked content preserves reading order across rotated blocks; disabling normalization keeps ligatures intact so we can decompose deliberately.
2. Load `commonObjs` for each `TextItem.fontName` once; cache font metrics (ascent, descent, italicAngle, unitsPerEm) plus the font's per-glyph advance widths.
3. For each `TextItem`:
   - Compose the glyph transform: `glyphMatrix = pageViewportRotation × itemTransform × fontMatrix × translate(cumulativeAdvance, 0)`.
   - Walk `item.str` code-point-aware (handles surrogate pairs). Ligature code points (`ﬁ` U+FB01, `ﬂ` U+FB02, `ﬃ`, `ﬄ`, `ﬅ`, `ﬆ`) become one `Glyph` with `cluster = ["f","i"]`, etc. — see the ligature table below.
   - Read each character's advance from the font's width table; fall back to `item.width / codepointCount` when a font ships no widths (Type 3, some scanned CIDs).
   - Compute `origin` = matrix applied to `(0,0)`, `bbox` = matrix applied to the glyph's four EM-box corners (0,-descent)-(advance,ascent), `aabb` = axis-aligned hull of `bbox.corners`.
   - Decompose the 2x2 to fill `rotation` and `skewX` (QR decomposition, guarded against zero determinants).
4. Preserve reading order via a monotonically increasing `order` counter that follows pdf.js emission — this survives rotated columns because `includeMarkedContent` interleaves items in visual reading order.

Ligature table (extend as needed):

```
FB00 ff → [f,f]        FB01 ﬁ → [f,i]        FB02 ﬂ → [f,l]
FB03 ﬃ → [f,f,i]      FB04 ﬄ → [f,f,l]      FB05 ﬅ → [ſ,t]
FB06 ﬆ → [s,t]        0132 Ĳ → [I,J]         0133 ĳ → [i,j]
0152 Œ → [O,E]         0153 œ → [o,e]         00E6 æ → [a,e]
```

## Transform + geometry (`transform.ts`, `bbox.ts`)

Pure math, no pdf.js dependency:

- `multiply`, `invert`, `apply(m, point)`, `translation`, `rotation(θ)`, `scale(sx,sy)`, `skew(x,y)`.
- `decompose(m) → { scaleX, scaleY, rotation, skewX }` using QR (Gram–Schmidt on columns), returns rotation in `[-π, π]`.
- `orientedBox(corners)`, `orientedAabb(box)`, `pointInOrientedBox(p, box)` — cross-product half-plane test (works for any rotation and moderate skew).
- `orientedBoxesIntersectRect(box, rect)` — SAT test between the oriented quad and the axis-aligned rect (used by rect selection over rotated text).

Every subsequent module goes through these — no ad-hoc rectangle math anywhere.

## Word grouping (`words.ts`) — display only

`groupWords(glyphs: Glyph[]): Word[]`.

Rules:

1. Group by `order` within the same baseline band. Baseline band = same y after rotating the glyph origin into the run's local frame; tolerance = `0.4 × fontSize`.
2. Advance to next glyph — if the horizontal gap in the run's local frame is `> 0.25 × fontSize`, close the current word.
3. Explicit whitespace glyphs close the word and are dropped.
4. Ligature clusters expand into `Word.text` using `cluster`.
5. Soft hyphen (U+00AD) or a trailing `-` immediately followed by a line break marks `softHyphenated = true`; the next line's first word is linked via `Word.continues`.
6. `Word.aabb` is the axis-aligned hull of the constituent glyph `aabb`s — used for tooltip / search-hit outlines only, never for selection.

Selection APIs never call `groupWords`. Words exist purely for the words layer / search UI.

## Hit testing (`hit.ts`)

All operations at glyph level:

- `glyphAtPoint(glyphs, p, opts?)` — coarse AABB filter, then `pointInOrientedBox` on candidates, returns the topmost by `order`.
- `glyphsInRect(glyphs, rect)` — coarse AABB filter, then SAT test; result sorted by `order`.
- `rangeBetween(glyphs, anchorId, focusId)` — resolves both ids, returns the closed `[min.order, max.order]` slice; no reliance on rectangles, so rotated / column layouts work.
- `caretNearest(glyphs, p)` — for click-to-place; picks the glyph whose baseline-projected distance to `p` is minimal, then returns "before" or "after" based on which side of the origin `p` falls.

## Selection quads (`quads.ts`)

`selectionQuads(glyphs, range): OrientedBox[]`.

Algorithm:

1. Slice glyphs by `order` from the range endpoints.
2. Bucket the slice into "runs of glyphs sharing near-identical rotation and baseline" — same page, `|Δrotation| < 0.02 rad`, baseline distance `< 0.3 × fontSize`.
3. For each bucket: sort by local-x (project origin onto the bucket's rotation axis), then union `OrientedBox`es along the baseline — every quad is oriented with the run, not axis-aligned. Ascender/descender come from `Glyph.ascent`/`descent`, so highlights sit exactly on the visible glyph metrics — no ad-hoc padding.
4. Return one oriented quad per bucket. Consumers convert to axis-aligned rects only when the render target requires it.

This is the only place highlight geometry is produced. Callers never compute their own word rectangles.

## OCR adapter (`ocr.ts`)

`ocrPageToGlyphs(pageIndex, words)` where each OCR word carries char-level boxes when available, otherwise the word box:

- Char-level (Tesseract `hocr` or `tsv`): one `Glyph` per character, `transform` reconstructed from the box (rotation from the word's `∠` if provided), `source: "ocr"`, `fontFamily: "generic-serif" | "generic-sans"` from the resolver.
- Word-level fallback: split the word into equal advances so downstream selection still hits at glyph granularity. `bbox` shares the word's rotation; `advance = wordWidth / charCount`.

The output plugs into the same `Glyph[]` pipeline — hit testing, selection quads, and word grouping treat OCR and PDF glyphs identically.

## Rotation & skew coverage

- Rotated pages: extraction composes the page rotation into `transform`, so glyph corners are already in page-oriented coordinates. Rect selection uses SAT so a horizontal drag over sideways text still selects correctly.
- Rotated text blocks (rotated CTM within an upright page): same code path — the per-glyph transform carries the rotation, `pointInOrientedBox` / SAT handle the geometry.
- Skewed text (italic simulated by shear, or slanted stamps): `decompose` reports non-zero `skewX`; oriented bbox is built from the sheared EM box so the highlight follows the slant.
- Hyphenated words: `softHyphenated` links the two halves for search / copy but does not merge geometry — each half stays a distinct set of glyphs on its own line.

## Tests

- `transform.test.ts` — multiply / invert round-trip; decompose recovers rotation and skew for known matrices; `pointInOrientedBox` accepts inside points and rejects outside for a 30° rotated box; SAT rect vs oriented box for overlap, contain, disjoint.
- `bbox.test.ts` — oriented AABB hull covers all four corners; empty input; single-point box.
- `words.test.ts` — `ﬁ` produces `Word.text === "fi"`; soft hyphen at line end sets `softHyphenated`; whitespace splits words; rotated run groups on the rotated baseline.
- `hit.test.ts` — `glyphAtPoint` picks the glyph under a point inside a rotated cluster; `glyphsInRect` returns rotated glyphs a horizontal drag rect crosses.
- `quads.test.ts` — a selection spanning two lines returns two quads; a selection across a 90°-rotated block returns one oriented quad; no ad-hoc padding sneaks in (quad height ≈ ascent+descent).
- `ocr.test.ts` — char-level and word-level fallback both yield selectable glyphs; word-level fallback distributes advances evenly.

## Non-goals for this change

- No caller migrated. `editor-canvas.tsx`, `quad-capture.ts`, and every existing selection/highlight consumer keep using the old text-run path unchanged.
- No changes to PDF open/parse, tab lifecycle, `samplePageBg`, or the sidecar model.
- No integration into the annotation store or export pipeline — those move over in a follow-up plan.
