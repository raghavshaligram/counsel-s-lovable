## Goal

Add three inspector features to the workspace:

1. **Compress** — mount the existing compress engine in the right inspector.
2. **Bates — change / delete** — extend the existing Bates panel so users can update or clear the stamp on the active tab.
3. **Remove watermark** — new tool that strips watermark-style overlays from a PDF.

All three run 100% on-device, follow the four-zone workspace layout (left rail → canvas → floating toolbar → right inspector), and reuse existing engines.

---

### 1. Compress panel (quickest win)

The compress engine already exists (`src/lib/batch/ops/compress.ts`, `compressSmart`) with presets Low / Medium / High / Extreme (structural rebuild + rasterise, keeps smaller). It is not currently mounted — `tool-panels.tsx` falls through to `ComingSoonPanel` for `"compress"`.

- Add `CompressPanel` to `tool-panels.tsx` next to `WatermarkPanel`.
- Controls: preset radio (Low / Medium / High / Extreme), color-vs-grayscale toggle, before/after size + % savings after run, "Compress & download" primary action.
- Runs `compressSmart` on the active tab's `srcBytes`. Result is offered as a download (does not mutate the open document, matching how Watermark works today).
- Register `case "compress": return <CompressPanel ctx={ctx} />;` in the switch.

### 2. Bates — change & delete

Today `BatesPanel` writes settings into the per-doc Bates store; the actual stamp is only baked in at export time. So "change" already works (edit settings → re-export). What is missing:

- **Clear stamp settings** button in `BatesPanel` — resets the tab's `BatesSettings` to `BATES_DEFAULT` and marks the tab so the export pipeline skips the Bates step.
- **Remove baked-in Bates from an imported PDF** — heuristic pass:
  - Scan each page for short text runs matching the user's format (`prefix + N digits + suffix`) inside a chosen corner band (tl/tc/tr/bl/bc/br).
  - Cover matches with an opaque white rect sized to the run's bbox (same technique the redaction pipeline uses).
  - Preview count ("Found 42 stamps on 42 pages") before applying, then export as `<name>-bates-removed.pdf`.
  - Undoable within the session (settings-driven; the source bytes are never mutated — the three-layer model is preserved).

Panel UX: existing "Apply Bates" section on top, new "Existing stamps" section below with format input, corner picker, "Detect", "Remove & download".

### 3. Remove watermark

Watermarks come in three shapes; the tool handles them in priority order and shows a checklist of what it found:

1. **Watermark annotations** (`/Subtype /Watermark`, stamp annotations flagged as watermarks) — drop from each page's `/Annots` array via `pdf-lib`. Lossless.
2. **Form XObjects reused on every page** — inspect each page's `/Resources /XObject`. Any XObject referenced on ≥ 60% of pages that overlays page content (not the base content stream) is offered as a removable candidate with a thumbnail. Removing rewrites the content stream to drop the `Do` operator for that XObject.
3. **Repeated text/image overlay** (no structured watermark) — user drags a marquee on any page; we sample that region, find visually similar regions on every other page, and cover with white rects. Same primitive as the Bates-removal path.

Panel UX: "Scan for watermarks" button → list of candidates with page-count + preview + individual toggles → "Remove selected & download". If nothing is found automatically, offer the manual marquee fallback.

Add to the left rail under **Edit & sign** as `"remove-watermark"` (label "Remove watermark", icon `EraserIcon`).

---

### Technical details

- New files:
  - `src/components/workspace/panels/compress-panel.tsx` (or inline in `tool-panels.tsx` matching current style).
  - `src/components/workspace/panels/remove-watermark-panel.tsx`.
  - `src/lib/pdf/remove-watermark.ts` — annotation strip + XObject-usage analyser + content-stream rewriter (pdf-lib).
  - `src/lib/pdf/remove-bates.ts` — regex scan on the pdf.js text layer + white-rect cover via pdf-lib.
- Extend `src/lib/workspace/bates-store.ts` with a `cleared: boolean` flag so the export pipeline knows to skip stamping.
- Left-rail additions in `workspace-shell.tsx`:
  - `"remove-watermark"` under Edit & sign.
  - (Bates entry already exists — no rail change needed.)
- Register new cases in `renderPanel` inside `tool-panels.tsx`.
- Reuse `downloadPdf`, `importChunk`, `useToast` patterns from `WatermarkPanel` / `BatesPanel` for consistency.
- No backend, no network — all operations stay in the browser.

### Out of scope / trade-offs

- Removing arbitrary flattened watermarks (rasterised into a page image) can only be done by re-rasterising and inpainting — heavy and lossy. The manual marquee is the pragmatic fallback and will be labeled as such.
- Removing Bates from a document stamped by a different tool with unknown format won't be perfect; the user must supply the format they see.
