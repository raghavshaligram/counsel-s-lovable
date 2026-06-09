# Editor Upgrade Plan

Two tracks, shipped together in the existing `/editor` route. No new tabs — everything lives in the current toolbar.

---

## Track 1 — Real Text Editing (replace the overlay hack)

### Problem today
The `edit-text` tool draws a whiteout rectangle + new text on top of the page. The original glyphs still exist in the PDF stream, search/copy returns the old text, and any misalignment is visible. We had this working earlier with a modal that committed real edits; we regressed when inline editing was added.

### Fix
Bring back true content-stream editing, but keep the inline UX:

1. **Click-to-edit flow**
   - User picks the **Edit Text** tool, clicks any text run on the page.
   - We use `pdf.js` `getTextContent()` to find the exact text item under the cursor (string, font name, size, transform matrix, page-space bbox).
   - A floating editor (contenteditable, positioned over the run) opens — same look as today's inline editor, but now backed by a real edit op.

2. **Commit = real PDF mutation, not overlay**
   - On commit we record a `TextEditOp { page, itemIndex, originalString, newString, fontRef, size, matrix, bbox }` on the doc — not an `Anno`.
   - On export we use `pdf-lib` to:
     a. Load the page's content stream, locate the `Tj`/`TJ` operator for that text item (matched by font + matrix + string), and replace its string operand with the new value.
     b. If the new string uses glyphs missing from the original font's encoding, fall back to embedding a matching standard font (Helvetica/Times/Courier family auto-picked from the original font name) and rewriting just that show-text op with the new font resource.
     c. No whiteout rectangle. The original glyphs are gone from the stream, so search/copy/accessibility all reflect the edit.

3. **Fallback path** for pages where the content stream can't be safely rewritten (e.g. text inside a Form XObject, custom CID font with no Unicode cmap): we degrade to the current whiteout overlay and badge the edit in the UI as "overlay only" so the user knows.

4. **Modal escape hatch**
   - Keep the inline editor as default.
   - Add a "Edit in dialog…" button on the floating editor that opens the full modal (multi-line, font/weight/size pickers) for heavier edits — this restores the workflow that previously worked reliably.

5. **Multi-line / reflow** stays out of scope for v1; we edit one text run at a time, same as Acrobat's basic Edit Text.

---

## Track 2 — Annotation Parity with Acrobat

### 2a. Text-aware highlight / underline / strikethrough (QuadPoints)
- Switch the three text-marker tools from "drag a rectangle" to "select text".
- Use pdf.js text layer: on mouse-down + drag, compute the selected character range and gather glyph rects → store as `QuadAnno { kind, page, rects[], selectedText }` (model already exists in `src/lib/annotate/types.ts`, reuse it inside the editor).
- Renderer draws one `<div>` per quad rect (multi-line selections work).
- Export writes one `pdf-lib` rectangle per quad (highlight = filled translucent, underline = thin bar at rect bottom, strike = bar at rect mid).
- Selected text is captured so the comments sidebar can show context.

### 2b. Comments sidebar + sticky notes
- New right-hand panel `CommentsPanel` listing every annotation that has `contents` or `replies`.
- Each entry: author, timestamp, snippet of `selectedText` (for quads) or annotation kind + page, body, threaded replies.
- Clicking an entry scrolls the page into view and flashes the annotation.
- Sticky-note (`note`) tool gets a proper popup with author + timestamp + threaded replies, not just a yellow square.
- Author defaults to the signed-in user (Lovable Cloud) or "You" when signed out.

### 2c. True redaction
- Today redactions are opaque black rectangles drawn over the page — text underneath survives.
- On export, for every `redact` anno:
  1. Find overlapping text runs via pdf.js `getTextContent()` for that page and erase those `Tj`/`TJ` operands from the content stream (same machinery as Track 1).
  2. Rasterize the redacted region: render that page region to a canvas at 200 DPI minus the redacted glyphs, embed the result as a JPEG, and stamp it back at the redaction bbox. This guarantees forensic removal even for vector art or embedded images under the box.
  3. Draw the visible black fill on top so the output looks like a standard redaction.
- A "Apply redactions" button in the toolbar lets users preview the destructive pass before export.

### 2d. Native PDF annotation export (optional toggle)
- Add an export setting `annotationsMode: "flatten" | "native"`.
- `native` writes real PDF annotation dictionaries (`/Highlight`, `/Square`, `/Circle`, `/Line`, `/FreeText`, `/Ink`, `/Text` for sticky notes) via `pdf-lib`, so other readers can edit them.
- `flatten` keeps today's behaviour (drawn into the page content).

### 2e. Advanced shapes
- Add `polygon`, `polyline`, `cloud` (rect with cloudy border), `callout` (text + leader line) tools.
- Each gets a toolbar button, pointer handler, renderer, and `pdf-lib` export path.
- Measurement (distance/area) deferred to a follow-up — it needs scale calibration UI.

---

## File-Level Changes

- `src/lib/editor/types.ts`
  - New ops: `TextEditOp` (real edit), `QuadAnno` reused from annotate types, `PolygonAnno`, `PolylineAnno`, `CloudAnno`, `CalloutAnno`.
  - `ExportSettings.annotationsMode`, `ExportSettings.applyRedactions`.
  - Comment fields on `BaseAnno`: `author`, `createdAt`, `contents`, `replies`.
- `src/lib/editor/text-edit.ts` (new) — pdf.js text-run lookup + content-stream rewrite helpers.
- `src/lib/editor/redact.ts` (new) — destructive redaction (stream erase + region rasterize).
- `src/lib/editor/export.ts` — branch on `annotationsMode`, run text edits + redactions before drawing, add native annotation writers, new shape draw paths, QuadAnno draw path.
- `src/lib/editor/text-layer.ts` (new) — shared selection → quad-rects helper used by highlight/underline/strike + edit-text + redact tools.
- `src/routes/editor.tsx`
  - Toolbar buttons for new shapes + "Apply redactions" + "Comments".
  - Replace rectangle drag with text-selection capture for highlight/underline/strike.
  - Inline text editor backed by `TextEditOp`; add "Edit in dialog…" button → existing modal restored.
  - Mount `CommentsPanel`.
- `src/components/editor/CommentsPanel.tsx` (new).
- `src/components/editor/StickyNotePopup.tsx` (new).
- Keyboard shortcuts unchanged; new tools get `P` (polygon), `C` already used → use `Shift+C` for cloud, `Shift+L` for callout.

## Out of Scope (v1)
- Measurement tools with scale calibration
- Reflowing multi-line text edits across line breaks
- Form-field editing (separate track)
- Collaboration / multi-user comment sync (local + per-doc autosave only)

## Validation
- Round-trip: edit a paragraph, export, reopen — text content (not overlay) reflects the change, copy/paste from the exported PDF returns the new string.
- Redaction: export, reopen, run `pdftotext` on the file — redacted strings absent.
- Highlight across line break: produces N quads, exports as N rectangles, hit-tested as one annotation.
- Comments panel: every annotation with a comment appears; clicking scrolls + flashes.
- Native vs flatten export: both modes open cleanly in Acrobat and Preview.
