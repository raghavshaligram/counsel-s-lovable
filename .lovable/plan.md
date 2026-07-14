
## Goal

Introduce a single, reusable `FontResolver` that maps any PDF/CSS font identifier to a normalized descriptor with confidence scoring. No existing consumer is modified in this pass — the resolver ships standalone with unit tests, ready to be adopted incrementally later.

Explicitly out of scope: `editor-canvas.tsx`, the PDF viewer, tab/open lifecycle, `samplePageBg`, and any live rendering path.

## Deliverables

New files only:

```text
src/lib/fonts/
  resolver.ts          # public API: resolveFont(...)
  registry.ts          # canonical font catalog (families + metadata)
  aliases.ts           # PostScript / PDF / CSS alias table
  normalize.ts         # PostScript name normalization
  types.ts             # FontDescriptor, FontQuery, ResolveResult
  index.ts             # barrel export
tests/fonts/
  normalize.test.ts
  resolver.test.ts
```

Nothing under `src/lib/editor/`, `src/lib/utils/fontMatcher.ts`, or `src/lib/pdf/fonts-pdfa.ts` is touched. Those keep working exactly as they do today.

## Public API

```ts
// types.ts
export type FontKind = "sans" | "serif" | "mono" | "display";
export type FontVendor = "microsoft" | "adobe" | "google" | "apple" | "legal" | "engineering" | "generic";

export interface FontQuery {
  descriptor?: string;      // 1. embedded PDF font descriptor (/FontName)
  postscriptName?: string;  // 2. PostScript name
  pdfFamily?: string;       // 3. PDF font family (/FontFamily)
  cssFamily?: string;       // 4. CSS family string
  weightHint?: number | string;
  italicHint?: boolean;
}

export interface CanonicalFont {
  id: string;               // "arial", "times-new-roman", ...
  family: string;           // display name
  kind: FontKind;
  vendor: FontVendor;
  cssStack: string;         // ready-to-use CSS font-family
  metricTwin?: string;      // e.g. "carlito" for Calibri
}

export interface ResolveResult {
  font: CanonicalFont;      // resolved family (falls back to generic)
  weight: number;           // 100..900
  italic: boolean;
  bold: boolean;            // weight >= 600
  confidence: number;       // 0..1
  exact: boolean;           // true iff matched via registry/alias, not generic
  source: "descriptor" | "postscript" | "pdfFamily" | "cssFamily" | "alias" | "generic";
  matchedKey?: string;      // which alias/id produced the hit
}

export function resolveFont(q: FontQuery): ResolveResult;
```

## Resolution order (implemented in `resolver.ts`)

For each provided field, in this order, try:

1. `descriptor` → normalize → exact registry id → alias table
2. `postscriptName` → normalize → registry id → alias
3. `pdfFamily` → lowercase trim → registry family → alias
4. `cssFamily` → split on comma, walk tokens through registry + alias
5. Known-alias fuzzy pass (substring match on normalized token against alias keys)
6. Generic fallback by `kind` inferred from tokens (`serif`/`mono`/else `sans`)

Confidence:
- descriptor/postscript exact = 1.0
- pdfFamily exact = 0.95
- cssFamily exact = 0.9
- alias hit = 0.8
- fuzzy substring = 0.6
- generic fallback = 0.2

`exact` is true for anything except the generic fallback.

## Normalization (`normalize.ts`)

Pure function `normalizePsName(raw): { base, weight, italic }`:

- strip subset prefix `^[A-Z]{6}\+`
- strip trailing `MT`, `PS`, `PSMT`, `LTStd`, `Std`, `Pro`, `LT`
- split on `-`, `,`, spaces; last segment is style token
- style tokens → weight/italic:
  - `Thin`=100, `ExtraLight/UltraLight`=200, `Light`=300, `Regular/Roman/Book`=400,
    `Medium`=500, `SemiBold/DemiBold`=600, `Bold`=700, `ExtraBold/UltraBold/Heavy`=800, `Black`=900
  - `Italic`/`Oblique` → italic=true (may combine, e.g. `BoldItalic`)
- collapse the remaining tokens into a canonical id (lowercase, hyphen-joined)

Cases explicitly covered by unit tests:

```
ArialMT                          → arial / 400 / false
Arial-BoldMT                     → arial / 700 / false
ABCDE+ArialMT                    → arial / 400 / false
HelveticaNeueLTStd-Roman         → helvetica-neue / 400 / false
TimesNewRomanPSMT                → times-new-roman / 400 / false
TimesNewRomanPS-BoldItalicMT     → times-new-roman / 700 / true
Calibri-Light                    → calibri / 300 / false
SegoeUI-SemiboldItalic           → segoe-ui / 600 / true
AptosDisplay-Bold                → aptos / 700 / false
```

## Registry (`registry.ts`)

Every listed family gets a `CanonicalFont` entry with id, display name, kind, vendor, and a CSS stack. Metric twins wired where applicable (Calibri→Carlito, Arial→Arimo, Times New Roman→Tinos, Cambria→Caladea, Courier New→Cousine). Covers:

- Microsoft: Arial, Arial Narrow, Calibri, Aptos, Cambria, Candara, Consolas, Courier New, Georgia, Segoe UI, Tahoma, Trebuchet MS, Verdana
- Adobe: Helvetica, Helvetica Neue, Times, Times New Roman, Myriad Pro, Minion Pro, Garamond, Warnock
- Google: Roboto, Open Sans, Noto Sans, Noto Serif, Inter
- Apple: SF Pro, Geneva, Lucida Grande
- Legal: Book Antiqua, Century Schoolbook, Bookman
- Engineering: OCR-A, OCR-B, DIN, Univers
- Generic sentinels: `generic-sans`, `generic-serif`, `generic-mono`

## Aliases (`aliases.ts`)

Flat `Record<normalizedKey, canonicalId>` covering common vendor spellings, e.g.:

```
arialmt, arial, liberationsans, nimbussans, arimo         → arial
helvetica, helveticaneue, helveticaneueltstd, nimbussansl → helvetica / helvetica-neue
timesnewroman, timesnewromanps, tinos, liberationserif    → times-new-roman
calibri, carlito                                          → calibri
segoeui                                                   → segoe-ui
sfpro, sfprodisplay, sfprotext, -apple-system             → sf-pro
bookantiqua, palatino                                     → book-antiqua
centuryschoolbook, newcenturyschlbk                       → century-schoolbook
bookmanoldstyle, itcbookman                               → bookman
ocra, ocrb, din, univers, myriadpro, minionpro, garamond, warnock, ...
```

## Tests

- `normalize.test.ts` — every case from the "Normalization" list above, plus edge cases (empty string, only style token, unknown vendor).
- `resolver.test.ts` — verifies resolution order (descriptor beats cssFamily), confidence tiers, `exact` flag, alias hits, generic fallback for unknown families, and italic/bold flag propagation.

## Non-goals for this change

- No changes to `matchPdfFont`, `mapPdfFontToKey`, `detectFontKey`, editor canvas, PDF viewer, tab lifecycle, or `samplePageBg`.
- No callers migrated in this pass. Follow-up plans will adopt the resolver in `editor/fonts.ts`, `utils/fontMatcher.ts`, and `pdf/fonts-pdfa.ts` one at a time.
