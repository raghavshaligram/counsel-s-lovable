## Three problems behind the "glitchy" feel

**1. Banner keeps shouting "this looks scanned"** even after OCR has run. No record of which pages were processed, so any text-light page re-triggers the same generic prompt.

**2. Text changes font when edited on an OCR'd page** (your screenshot: scan is serif, replacement renders sans). OCR pipeline writes the invisible text layer in `StandardFonts.Helvetica`, so edit-text reads "Helvetica" as the run font and seeds new typed text in Arimo — bitmap underneath is still serif → visible mismatch.

**3. Re-running OCR starts from page 1 every time.** If you stopped at page 3 of 12, hitting "Run OCR" again re-processes pages 1–3 even though they're already done. Today's pipeline only skips pages that have a native text layer; it doesn't know we already OCR'd a page in a previous run.

---

## What I'll change

### A. Per-page OCR record (per tab)

- Tab state gains `ocrPages: number[]` (OCR'd), `ocrPagesCopied: number[]` (had text, copied through), `ocrIsPartial: boolean`.
- During OCR, collect each completed page from the progress callback (`stage: "ocr" | "copied" | "skipped"` already fires per page). Stop/abort → only completed pages recorded, `ocrIsPartial = true`. Full success → all pages, `ocrIsPartial = false`.
- Carry the set forward when the file is patched (` (OCR)` / ` (OCR partial)`). Reset only when a different file is loaded.

### B. Resume-from-where-we-stopped (the new fix)

- `ocrPdfToSearchable` gets a new option: `skipPageIndices?: number[]`. Pages in that set bypass render + OCR entirely and are copied through (same path as a native-text page today). They still appear in the output PDF in order, so embed cursors stay correct.
- `onRequestOcr` passes `skipPageIndices = [...ocrPages, ...ocrPagesCopied]` from the active tab.
- "Run OCR" button copy becomes context-aware:
  - First run: **"Run OCR"**
  - Resume: **"Resume OCR (pages 4–12)"** — concrete page range, so you know what's about to happen.
- Toast on completion reports only the newly-processed pages: *"OCR added on pages 4–7."* Stop → *"Stopped — added pages 4–5. 7 pages still scanned."*

### C. Per-page OCR tag (visible badge on the canvas)

- Small amber chip pinned to the top-right corner of each page in `ocrPages` / `ocrPagesCopied`. Copy:
  - OCR'd page: **"OCR"**
  - Copied through (already had text): **"Searchable"** (lighter weight)
- Hover tooltip explains state. Uses existing tokens (`bg-vault/15 text-vault border-vault/40`).
- Visible only while the edit-text tool is active — canvas affordance, not a new panel. Honours the four-zone rule.

### D. Smarter banner logic

- `unprocessedScanned = scannedPages \ (ocrPages ∪ ocrPagesCopied)`.
- Running OCR → progress + Stop (unchanged).
- `unprocessedScanned.size > 0` AND not dismissed → show offer with concrete copy: *"Page 4 still looks scanned"* / *"Pages 4–12 still look scanned — resume OCR?"*.
- `unprocessedScanned.size === 0` AND `ocrPages.size > 0` → banner hidden. The per-page tag carries the message.
- "Not now" dismisses for this file/session.

### E. Serif-by-default text on OCR'd pages (the font fix)

1. **OCR pipeline writes its invisible text layer in `StandardFonts.TimesRoman`** instead of Helvetica. Still `opacity: 0` — pure metadata switch — but edit-text reads the run font, so new typed text defaults to Tinos and matches typical scans.
2. **On pages in `ocrPages`, edit-text defaults new text/edit boxes to `tinos`** regardless of detected run font (covers legacy OCR'd files where the layer is still Helvetica).
3. One-line hint in the right inspector when editing on an OCR'd page: *"Scanned page — replacement text reconstructed in a Times-style serif. Change in Font."*

### F. Honest progress copy

Pipe the existing per-page progress string straight into the running banner subline instead of the static "Recognising text on-device…". Stop button stays.

---

## Files I'll touch

```text
src/lib/pdf/ocr-pdf.ts
  - drawWordsOnPage: embed TimesRoman instead of Helvetica
  - OcrOptions: add skipPageIndices?: number[]; pages in set go through
    the copy-through branch (no render, no Tesseract, no JPEG)

src/lib/workspace/tabs.ts (TabState)
  - add ocrPages?: number[], ocrPagesCopied?: number[], ocrIsPartial?: boolean

src/components/workspace/workspace-shell.tsx
  - onRequestOcr: pass skipPageIndices from tab; collect newly-completed
    pages from progress; persist on the tab via patchActive
  - "Run OCR" button label: first-run vs resume
  - showOcrBanner: use unprocessedScanned
  - Pass ocrPages + ocrPagesCopied down to EditorCanvas
  - On edit-text for a page in ocrPages: default font = tinos

src/components/workspace/editor-canvas.tsx
  - Render per-page "OCR" / "Searchable" tag (top-right, edit-text only)

src/lib/editor/state.ts
  - Accept "prefer-serif" hint when seeding a new text-edit / text anno
```

No new deps. Old tabs without `ocrPages` behave like fresh files.

---

## Out of scope

- Real per-glyph font detection from the scan image (would need a font classifier).
- Re-OCR'ing a page we already processed (resume only forward — if you want to redo a page, that's a separate "Re-OCR this page" action we can add later).
