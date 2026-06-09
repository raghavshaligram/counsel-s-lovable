# Editor Upgrade — Track 1 then Track 2

Two passes, landed in order. Track 1 ships before Track 2 begins so you can sanity-check the destructive rewrite before annotations grow.

## Track 1 — Destructive text + redact rewrite

Goal: editing or redacting text actually removes the underlying glyphs from the PDF stream. Search/copy in Acrobat/Preview/pdftotext returns the new text, not the original.

### Capture (editor side)
- Extend the `edit-text` flow so when pdf.js detects a text item we store:
  - `originalString` (decoded text from `getTextContent()`)
  - `transform` matrix (a..f)
  - `fontName` (pdf.js style entry)
  - `page` index
- Store these on a new optional `source` field on `TextEditAnno`.
- Add a new annotation kind `redact` with: bbox, optional `overlayLabel`, and a captured list of text items it overlaps (same `source` shape, one per item).

### Rewrite (export side, `src/lib/editor/text-rewrite.ts`)
- New helper `rewritePageText(page, edits, redactions)`:
  1. Read the page's content stream(s) via `page.node.normalizedEntries().Contents` → flatten to a single decoded operator list using pdf-lib's `PDFContentStream` / `PDFOperator`.
  2. Walk operators tracking current font (`Tf`) and text matrix (`Tm`/`Td`/`TD`/`T*`).
  3. For each `Tj` / `TJ` / `'` / `"` operator:
     - Decode operand into a glyph string using the active font's `/ToUnicode` CMap (fallback: WinAnsi for Standard 14).
     - Match against any pending edit/redact by (string fuzzy-eq, matrix close-enough, font ref).
     - **Edit:** replace operand with the new string re-encoded for the same font when possible; if the font lacks glyphs, swap to a standard font via `Tf` + `Tj` (still removes original).
     - **Redact:** delete the operator entirely.
  4. Re-serialise operators back to the page's content stream.
- Best-effort: unsafe cases (Form XObjects, CID fonts with no /ToUnicode, scanned pages) fall back to the existing whiteout overlay + a visible "overlay only" badge in the editor list so you know it didn't truly erase.

### Visual layer (kept)
- Whiteout + redraw stays as the user-visible result of `text-edit` (looks identical regardless of rewrite success).
- Redact draws a solid black rectangle (configurable colour) over the bbox.
- New "Apply redactions" preview button: re-renders the page from the rewritten bytes so you can confirm before export.

### Files
- New: `src/lib/editor/text-rewrite.ts`, `src/lib/editor/cmap.ts` (ToUnicode decoder).
- Edited: `src/lib/editor/types.ts` (add `source`, `redact` kind), `src/lib/editor/export.ts` (call `rewritePageText` before drawing annos), `src/routes/editor.tsx` (capture pdf.js text item metadata, add Redact tool wiring + apply-preview).

### Validation
- Round-trip: edit a word → export → reopen → copy text → contains the new word, not the old.
- Redaction: redact a word → export → `pdftotext` output omits it.
- CID font sample: edit gracefully falls back; export still succeeds and overlay shows the new text.

---

## Track 2 — Comments sidebar + quad highlights

Goal: text-selection-driven highlight/underline/strike, threaded comments on every annotation, Acrobat-style sticky-note popups.

### Quad highlights
- Mount pdf.js text layer over each page canvas (existing `PageCanvas`).
- When highlight/underline/strike tool is active, native selection is used; on `mouseup` compute selection rects via `range.getClientRects()`, convert to PDF points, store as `quads: {x,y,w,h}[]` on the annotation.
- Extend `HighlightAnno` / `UnderlineAnno` / `StrikethroughAnno` with optional `quads`. Drag-rectangle behaviour stays as fallback when no text is selected.
- Export: when `quads` present, draw one rect per quad instead of a single bbox.

### Comments + replies
- Add `contents: string`, `author: string`, `createdAt: number`, `replies: { id, author, text, createdAt }[]` to `BaseAnno`.
- New `src/components/editor/CommentsPanel.tsx` — right-side collapsible panel listing every annotation grouped by page, with reply box and resolve toggle. Clicking a comment scrolls/zooms to its annotation.
- New `src/components/editor/StickyNotePopup.tsx` — opens on click for `note` annotations, shows author/timestamp, contents, replies. Replaces the current inline textarea for notes.
- Author defaults to "Me" (no auth required); editable per-session in panel header.

### Files
- New: `src/components/editor/CommentsPanel.tsx`, `src/components/editor/StickyNotePopup.tsx`, `src/lib/editor/quad-capture.ts`.
- Edited: `src/lib/editor/types.ts`, `src/lib/editor/export.ts`, `src/routes/editor.tsx` (mount text layer, swap inline note UI for popup, mount panel).

### Validation
- Select two lines of text → highlight tool → produces 2 quads, exports as 2 rects.
- Add a reply on a sticky note → reload (in-memory) → reply persists for the session.
- Comments panel "jump to" navigates and flashes the annotation.

---

## Out of scope (this round)
- Persistence to backend (still in-memory per session).
- Native `/Highlight`, `/Square`, `/Ink` PDF annotation dictionaries (flatten-only for now — works in every viewer).
- Measurement tools, form-field editing, multi-user comment sync.
