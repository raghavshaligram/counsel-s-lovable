## Two independent bugs — both root-caused

### 1. Every font lands on `vaultarimo`

`editor-canvas.tsx` feeds the resolver bad inputs at both call sites:

**Extraction path (~line 482):**
```ts
resolveToFontKey({
  postscriptName: sanitizedFontName || undefined,
  pdfFamily: family,          // ← "sans" | "serif" | "mono", NOT a family
  cssFamily:  sanitizedCssFamily || undefined,
  ...
})
```
- `pdfFamily` gets `"sans"` (a kind bucket, not a family) → resolver's alias table misses it.
- pdf.js hands us opaque font ids like `g_d0_f1`; `isOpaquePdfjsFontId` strips them, so `sanitizedFontName` and `sanitizedCssFamily` are usually `undefined`.
- The extracted `descRealName` from the FontDescriptor is folded into `postscriptName`, but the resolver's highest-confidence slot (`descriptor:`) is never used, and the descriptor's `/FontFamily` is never passed either.
- With every real slot empty, the resolver falls to generic → `inferKindFromTokens(["sans"])` → `generic-sans` → bridge's `KIND_TO_KEY.sans` → **arimo**. Same at the edit-click path (~line 1172).

### 2. White rectangle on a white page

The cover rect padding (lines 1147–1154) is 62% taller than the glyph:
```ts
coverPadTop    = 0.22 * h   // 0.30 * h if bold
coverPadBottom = 0.40 * h   // always
coverPadX      = 0.18 * h   // 0.28 * h if italic
```
For a 32 px heading, cover is ~52 px tall — it extends well into the line below and paints that strip with the sampled page color (white on a white page). That is exactly the white band you see slicing through the next line "Quick-reference ratios, volumes…" in the screenshot. It has nothing to do with the overlay's own background (already transparent) or the sampler — the cover is simply oversized.

## Fix plan (surgical, no canvas / viewer / samplePageBg / lifecycle changes)

### A. Wire the resolver correctly

`editor-canvas.tsx`, only the two `resolveToFontKey` call sites:

- **Extraction (~482):**
  - `descriptor: descRealName || undefined` — highest-confidence slot.
  - `postscriptName: it.fontName` (non-opaque, unchanged).
  - Drop `pdfFamily: family` entirely — never pass the kind bucket.
  - `cssFamily: sanitizedCssFamily` (unchanged).
  - After the call, only fall back to `kind` when `resolved.matched === false`.
  - Persist the resolver's canonical `family` name into `it.cssFamily` so edit-time has a real family even when the raw name was opaque.
- **Edit click (~1172):** same wiring — `descriptor`, `postscriptName`, `cssFamily`; no kind bucket.
- **OCR pseudo-item (~544):** leave the existing `detectFontKey("Helvetica"…)` untouched — OCR truly has no font.

### B. Shrink the cover to real glyph metrics

- Tighten pads: `coverPadTop = max(1, 0.08 * h)`, `coverPadBottom = max(1, 0.12 * h)`, `coverPadX = max(1, 0.06 * h)` (0.10 for italic). This keeps a 1–2 px anti-alias halo but stops the rect from reaching into adjacent lines.
- Clamp cover height so it never exceeds `it.h * 1.25` regardless of pad.
- No change to `samplePageBg`, no change to `boxW/boxH` measurement paths beyond the pad values they already read.

### C. Verify

- `bun test tests/fonts/*` — resolver + bridge tests stay green; add one bridge assertion: `resolveToFontKey({ descriptor: 'TimesNewRomanPSMT' })` → `tinos`.
- Open a Calibri PDF → `[bold-diag] extract` logs `resolvedFontFamily` containing `VaultCarlito`, not `VaultArimo`.
- Open the Soil & Raised Bed cheat-sheet → edit the heading → no white band bleeds into the paragraph below.

### Out of scope (untouched)
PDF viewer, tab lifecycle, `openPdf`, `samplePageBg`, `/editor`, `/redact`, tool-panels, all font-resolver modules, `matchPdfFont`.

### Files touched
- `src/components/workspace/editor-canvas.tsx` — 2 resolver call sites rewired + 3 pad constants + 1 clamp (~25 lines total).
- `tests/fonts/bridge.test.ts` — 1 assertion added.
