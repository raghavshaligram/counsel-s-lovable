## Diagnostic pass 2 — pin the exact stage that loses bold weight

No fix yet. Add one temporary console.log, re-open the doc, capture the row for the bold "RE:" run, then decide.

### Why the previous logs weren't enough
- `[text-edit-font] dom` fires whenever a text-edit anno is active — it confirmed the STORED weight is 400 (`computedFontWeight: '400'`), but not why.
- `[text-edit-font] extraction` only fires inside `onClickEditHit` (line 1000). If the run was already promoted to a `text-edit` anno on a prior click, re-entering edit mode skips that path — which is why nothing printed this session.
- The page-render extraction site (`content.items.flatMap`, ~line 379) has NO logging today.

### Strongest suspect from code read
`numericFontWeight` (line 56-64) returns the matcher's numeric weight unconditionally:
```
if (typeof weight === "number") return weight;
```
Both call sites — line 399 (page-render) and line 1056 (click-to-edit) — pass `matched.fontWeight`. If the fontMatcher returns `400` for "Times New Roman" (its default face), a truly-detected bold run is silently demoted to 400. The `bold` argument is only consulted when the matcher returned `undefined`. This alone would explain `computedFontWeight: '400'` on a bold heading matched to Times New Roman.

But we don't know yet whether `bold` was even `true` at detection — pdf.js sometimes exposes the descriptor weight only in the `styles` map (which the current code reads), sometimes only in the font-name suffix. We need one datapoint to disambiguate.

### Change (logging only, one site)
File: `src/components/workspace/editor-canvas.tsx`, inside the `content.items.flatMap` at ~line 379-419, right before the `return [{...}]` on line 418, add:

```ts
if (it.str && it.str.length >= 2) {
  console.log("[bold-diag] extract", {
    str: it.str.slice(0, 40),
    rawPdfFontName: it.fontName,
    pdfCssFamily: styleEntry?.fontFamily,
    pdfjsStyleFontWeight: styleWeight,
    weightIsBold,
    nameIsBold,
    detectedBold: bold,
    matcherFontFamily: matchedFont.fontFamily,
    matcherFontWeight: matchedFont.fontWeight,
    storedFontWeight: fontWeight,
  });
}
```

No other change. This fires once per text run on page render — noisy but bounded and reverted after diagnosis.

### Reproduction
1. Reload the workspace tab (fresh page render, so the log runs).
2. Filter devtools console by `[bold-diag]`.
3. Find the row where `str` starts with `RE:` or `Engagement`.
4. Report the full JSON of that row.

### Decision matrix (for the follow-up fix — separate build-mode plan)
- `detectedBold=false` → the bold signal never surfaces from pdf.js. Fix at detection (probably need `it.fontName` suffix parsing, or pull weight from the font descriptor via `page.commonObjs`).
- `detectedBold=true` AND `matcherFontWeight` is a number (e.g. `400`) AND `storedFontWeight=400` → confirmed `numericFontWeight` bug. Fix by preferring `bold ? 700 : matched.fontWeight ?? 400` when `bold` is explicitly true, i.e. bold detection always wins over the matcher default face.
- `detectedBold=true` AND `storedFontWeight=700` but DOM still shows 400 → something between extraction and render is stripping it. Investigate the anno construction in `onClickEditHit` (line 1000-1068) and the render override chain.

Nothing else is touched.