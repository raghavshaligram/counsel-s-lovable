
# OCR speedups

Re-read the OCR pipeline. The three tactics you listed are mostly already in place — but the implementation leaves real wins on the table. Here's what to change.

## Already done (no change)

- **Native-first bypass** — `ocr-pdf.ts` line 228 already calls `getTextContent()` and skips Tesseract when the page has ≥12 text items.
- **Worker pool** — lines 138–155 spin up `min(4, cores/2)` persistent Tesseract workers and dispatch pages in parallel.
- **Render scale** — set to 1.5x (≈108 dpi), a notch below your 2x recommendation.

## What to add

### 1. Copy-through native pages (biggest win)

The native-first check skips Tesseract, but the page still gets rasterised to a canvas and JPEG-encoded. For a Word-exported 400-page PDF, that's 400 unnecessary canvas renders + JPEG encodes — minutes of work for zero benefit.

Fix: when a page has a real text layer, skip the raster entirely and use pdf-lib's `copyPages` to clone the original page bytes into the output PDF. The output stays searchable (text layer already there) and we touch the page in milliseconds instead of seconds.

Expected impact: on a mostly-native PDF, ~20–50x faster. On a fully-scanned PDF, no change.

Edge case: mixed PDFs with some native + some scanned pages need page ordering preserved across two code paths. The existing `pending` map + `nextToEmbed` cursor already handles out-of-order completion, so this slots in cleanly.

### 2. Parallel OCR pool in redact's auto-detect

`src/lib/pdf/detect-pii.ts` has a serial OCR pass (lines 87–115) using a single Tesseract worker. On a 426-page scanned PDF this is the bottleneck. Mirror the pool pattern from `ocr-pdf.ts` — 4 workers, dispatch in parallel.

Expected impact: ~3–4x faster auto-detect on scanned PDFs.

### 3. Optional "High accuracy" toggle (2x render)

Add a checkbox on the OCR page: "High accuracy (slower)". When on, bump `RENDER_SCALE` from 1.5 to 2.0. Default stays at 1.5 to keep speed for the common case; users who get garbled output on small text or tight kerning can opt in.

Expected impact: ~80% slower when enabled, but noticeably better accuracy on small fonts and dense layouts.

## Files touched

- `src/lib/pdf/ocr-pdf.ts` — add copy-through branch + accept a `highAccuracy` option.
- `src/lib/pdf/detect-pii.ts` — refactor the OCR pass to use a worker pool.
- `src/routes/ocr.tsx` — add the High accuracy checkbox + pass the flag through.

## What I'm NOT changing

- Pool size formula. `min(4, cores/2)` is already a safe ceiling — each Tesseract worker holds ~15 MB of language data, and going higher OOMs cheap laptops faster than it speeds things up.
- Default render scale. 1.5x is the right default; 2x as opt-in.
- Compression / JPEG quality. Already tuned at 0.78.

## Order of work

1. Copy-through native pages (single biggest win, isolated to `ocr-pdf.ts`).
2. Worker pool in `detect-pii.ts`.
3. High-accuracy toggle on the OCR route.

