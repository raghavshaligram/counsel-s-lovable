
## Current state vs. the target model

Good news — the codebase is already 80% on the three-layer model:

- **Base layer**: `EditorDoc.srcBytes` (Uint8Array) is loaded into pdf.js for rendering. It is the original PDF bytes.
- **Sidecar (data)**: `EditorDoc.annotations: Anno[]` and `EditorDoc.pages: PageOp[]` already hold every edit type as structured JSON — text, highlights, shapes, freehand, notes, images, signatures (image annos), form-field text, redaction marks, text-edits, and page-level ops (reorder, rotate, delete, insert-blank, crop).
- **Render**: `editor-canvas.tsx` renders pdf.js pages and overlays the annotations on top — no PDF rebuild per keystroke.
- **Export**: `src/lib/editor/export.ts::exportEditedPdf(doc)` is already the single place the PDF is rebuilt. Redaction already destroys content there (RedactAnno erases overlapping text from the content stream + paints the fill).

Two real violations remain, and they are the actual source of the bugs the user is hitting:

1. **OCR mutates the base.** `onRequestOcr` in `workspace-shell.tsx` swaps `active.file` with a fully rebuilt OCR'd PDF and treats that as the new `srcBytes`. The pristine original is lost; every reload starts from the mutated file; "ghost text" and re-render glitches trace back to this.
2. **The sidecar isn't persisted.** IndexedDB stores only `bytes` (the file) per recent doc — annotations, page-ops and crops are not saved. Reload = lose edits.

The plan is to close those two gaps and document the invariant so we don't violate it again, not to rewrite the canvas.

---

## Changes

### 1. Base stays pristine — introduce an OCR text-layer sidecar

- Add a new sidecar field on `EditorDoc`:
  ```ts
  ocrLayer?: { page: number; tokens: { x:number; y:number; w:number; h:number; text:string; rot?:number }[] }[]
  ```
  Each entry is per-source-page invisible glyph data — exactly what `ocrPdfToSearchable` currently bakes into the rebuilt PDF.
- Refactor `src/lib/pdf/ocr-pdf.ts` to expose `ocrPdfToTokens(file, …)` returning the same per-page token data it already computes, WITHOUT writing a new PDF. Keep the existing `ocrPdfToSearchable` as a thin wrapper that calls `ocrPdfToTokens` and then bakes — used only by the export path and by the legacy `/ocr` route.
- In `workspace-shell.tsx::onRequestOcr`, stop swapping `active.file`. Instead:
  - keep `srcBytes` untouched,
  - dispatch a new action `SET_OCR_LAYER` that merges new pages into `doc.ocrLayer`,
  - keep the existing `ocrPages` / `ocrPagesCopied` per-tab memory.
- In `editor-canvas.tsx`, when a page has `ocrLayer` entries, render them as an invisible (or visually hidden) text layer aligned to the page — same approach pdf.js uses for selectable text. This makes the page editable (Edit tool can hit tokens) and selectable/copyable, without touching the base PDF.
- In `exportEditedPdf`, after the page graphics are written, embed the `ocrLayer` tokens as invisible text on each corresponding output page (text rendering mode 3). This is the same baking the OCR pipeline does today — just moved to export.

Net effect: OCR is now a pure sidecar edit. Pausing/stopping OCR can never drop pages. Reopening a file replays the sidecar.

### 2. Persist the sidecar in IndexedDB (on-device only)

- Add a third object store `sidecars` to `vaultpdf-workspace` (keyed by the recent doc id) holding `{ annotations, pages, ocrLayer, fileName, savedAt }`. Structured-clone safe; no Uint8Array except inside `ocrLayer` if needed.
- New helpers in `src/lib/workspace/persistence.ts`: `saveSidecar(id, sidecar)` (debounced), `loadSidecar(id)`, `deleteSidecar(id)`.
- In `workspace-shell.tsx`:
  - debounce-save the sidecar whenever `editorState.doc` changes (annotations, pages, ocrLayer),
  - when opening a recent doc, after `LOAD`, look up the sidecar by id and dispatch a new `LOAD_SIDECAR` action that merges saved annotations/pages/ocrLayer onto the freshly loaded base,
  - on `removeRecent`, also `deleteSidecar`.
- Eviction in `evict()` removes orphaned sidecars.

### 3. Reducer additions

In `src/lib/editor/state.ts`:

- New actions: `SET_OCR_LAYER` (merge per-page tokens), `LOAD_SIDECAR` (merge persisted annotations/pages/ocrLayer onto current `doc`, only when fileName + page count match).
- `LOAD` resets `ocrLayer` to undefined (fresh base).
- Undo/redo already snapshots `EditorDoc` — `ocrLayer` rides along for free.

### 4. Confirm every edit writes to the sidecar (audit, not rewrite)

Quick code audit to verify nothing else mutates `srcBytes`:

- text edits → `TextEditAnno` ✅
- annotations / shapes / highlights / freehand / notes / images → `Anno[]` ✅
- form-field values → currently routed through `sign-fill` only at export ✅ (verify)
- signatures → image annos ✅
- page reorder/delete/insert/rotate/crop → `PageOp[]` ✅
- redaction marks → `RedactAnno`, destructive only at export ✅

Any place that still calls `PDFDocument.load(srcBytes)` outside of `exportEditedPdf` or read-only metadata gets flagged. Fix is to move that work into export.

### 5. Document the invariant

Append a short "Three-layer model" section to `mem://project/constitution`:
- Base is read-only after `LOAD`. Never write to `srcBytes`.
- Every edit writes to the sidecar (`annotations`, `pages`, `ocrLayer`).
- The canvas composites base + sidecar live.
- `exportEditedPdf` is the only place the PDF is rebuilt. Redaction destroys content here.
- Sidecar persists to IndexedDB. Nothing uploads.

---

## Files touched

- `src/lib/editor/types.ts` — add `ocrLayer` to `EditorDoc`, token type.
- `src/lib/editor/state.ts` — `SET_OCR_LAYER`, `LOAD_SIDECAR` actions.
- `src/lib/editor/export.ts` — embed `ocrLayer` invisible text per page.
- `src/lib/pdf/ocr-pdf.ts` — extract `ocrPdfToTokens`; keep `ocrPdfToSearchable` as a wrapper.
- `src/lib/workspace/persistence.ts` — `sidecars` store + save/load/delete + eviction.
- `src/components/workspace/workspace-shell.tsx` — stop swapping `file` on OCR; dispatch `SET_OCR_LAYER`; auto-save sidecar on doc change; load sidecar on open.
- `src/components/workspace/editor-canvas.tsx` — render the OCR text layer overlay so Edit tool can target it.
- `mem://project/constitution` — record the invariant.

## Out of scope (explicitly not changing in this pass)

- Floating toolbar, left rail, right inspector layout — untouched.
- No new feature panels.
- No change to undo/redo behavior beyond `ocrLayer` riding along.
- No server calls anywhere — sidecar is IndexedDB only.

## Risks / things to verify after build

- Old recent docs that were stored as the OCR'd file (post-bake) will keep working — they're just treated as a normal base PDF with no ocrLayer sidecar.
- Migration: a one-shot helper detects a recent doc whose name ends in ` (OCR)` / ` (OCR partial)` with no sidecar — leaves it as-is (no auto-revert). User can re-run OCR on the pristine original if they re-open it; otherwise the baked file keeps working.
- Verify Edit tool hit-testing works against the OCR text-layer overlay the same way it works against pdf.js' native text layer today.
- Verify export produces a searchable PDF identical (within tolerance) to the current `ocrPdfToSearchable` output for the same input.
