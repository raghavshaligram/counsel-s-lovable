# Redact tool — pro upgrade

Current state (already shipped, don't re-do):
- Pattern auto-detect (SSN, email, phone, card, date, IP, IBAN) with category toggles.
- True rasterization on export (page rendered to canvas, black boxes drawn, re-embedded as JPEG — text is physically gone).
- Metadata stripped on export (title/author/subject/keywords cleared, producer/creator overwritten).

This plan adds the four asks on top, scoped to the redact route + detect-pii lib.

## 1. Keyword search-and-redact-all

New "Find & redact" panel in the right sidebar above the category toggles.
- Input: text field + "Match case" + "Whole word" checkboxes + "Redact all" button.
- On submit: walk every page's pdf.js `getTextContent()` once (cache results in a ref keyed by page) and produce a `Box` per text item whose `str` matches. Box geometry uses the same `viewport.transform` math already in `detect-pii.ts` (extracted into a shared `textItemToBox` helper in `src/lib/pdf/detect-pii.ts`).
- Matches are stored as a new `keywordBoxes` state array, merged into `allBoxes` alongside `autoBoxes` and manual `boxes`. Each keyword query gets a chip ("client-name · 14") with an × to remove the whole batch.
- Performance: extraction runs lazily on first search and is cached; subsequent searches reuse the cached text items.

## 2. Exemption codes on boxes

Extend the `Box` type with optional `label?: string` and `labelPreset?: string`.
- Double-clicking a drawn rectangle (manual or keyword/auto) opens a small popover anchored to the box with:
  - Preset dropdown: FOIA b(1)–b(9), Privacy Act, Attorney-Client, Work Product, Trade Secret, PII, PHI/HIPAA, Custom.
  - Free-text override.
- Labels render in the live preview as white text centred over the black rectangle, auto-sized to fit (binary-search font size against `ctx.measureText` so the label never overflows).
- On export, the same label is drawn onto the composite canvas in white before JPEG encoding, so it's permanently baked in.
- Sidebar shows a "Default label for new boxes" picker so users can stamp many boxes with one code without re-opening each.

## 3. Metadata stripping — make it explicit + thorough

- Add a toggle in the export panel: `[x] Strip hidden metadata on export` (default on, persisted to localStorage).
- When on, in addition to the current `setTitle/Author/Subject/Keywords/Producer/Creator`, also:
  - `setCreationDate(new Date(0))`, `setModificationDate(new Date(0))`.
  - Remove the XMP metadata stream: `out.catalog.delete(PDFName.of('Metadata'))`.
  - Strip document-level `PieceInfo` and `AcroForm` if present (these often retain edit history / form field values).
- Because export already re-rasterizes pages, hidden text layers and incremental-save history are already gone — call that out in the toast copy.

## 4. Vector / image flattening

Already implemented (raster pipeline in `exportRedacted`). No change needed; we will just tighten the explanatory copy in the hero + export confirmation toast so users understand the moat.

## Files touched

- `src/routes/redact.tsx` — new sidebar sections (keyword search, default label, metadata toggle), Box type extension, double-click → label popover, canvas label rendering for preview + export, extra metadata stripping.
- `src/lib/pdf/detect-pii.ts` — export a `textItemToBox(item, viewport, pdfjs, scale)` helper reused by both auto-detect and keyword search; add `searchKeywordInPdf(file, query, opts)` that returns `Detection[]`-shaped boxes with `category: "keyword"`.
- Small UI additions: a `<Popover>` (already in shadcn) for the exemption editor, a `Badge`-style chip list for active keyword queries.

No backend, no schema changes, no new deps.
