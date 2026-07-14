# Fix text-edit color + background

**Recommendation:** Fully transparent cover, keep the PDF's own text color, and erase the original glyph pixels from the base canvas so nothing double-renders. This is the only option that survives on both light and dark pages without guessing.

## Why the current build is wrong

1. `sampleTextColor` throws away every pixel with `lum > 230`, so white/near-white ink (your dark-teal heading) collapses to the default `#000`. Result: dark text where it should be light.
2. `samplePageBg` paints a solid rectangle under the edit. Even a "correct" sample can never match a gradient, an image, or a subtle noise texture — you always see a visible band. That's the "changes the bg color" complaint.
3. Sampling the ink from the halo (bg logic) and sampling the bg from the ink (color logic) are both fighting the same ambiguity from the wrong side.

## Fix

### 1. Text color from pdf.js, not pixels
`TextItem.color` is already populated from pdf.js's text layer (the declared fill color of the run). Use it directly for the editable overlay. Drop `sampleTextColor` from `onClickEditHit` and delete the helper — pixel sampling can't beat the source of truth.

### 2. Transparent cover
Stop painting `cover` with the sampled bg. `renderAnno` renders the text-edit cover element with `background: transparent` (still keeps the rectangle for hit-testing and layout; only the paint changes). Remove `bg` from the sampling call and from `intendedCoverBackground` logging.

### 3. Erase original glyphs from the base canvas
So the underlying pdf.js glyphs don't bleed through the transparent cover, we destructively clear that region on the rendered page canvas at edit-open time:
- Compute the same DPR-scaled `sx/sy/sw/sh` rect used for sampling, expanded by the cover pads.
- `ctx.clearRect(...)` on the page canvas — this leaves a hole showing whatever the canvas was cleared to (transparent), which composites over the surface behind it.
- Because the page canvas sits on a **plain page-color surface** (the workspace paints the page rect with the sampled page fill from the four corners — a much more reliable read than the ring around one glyph), the hole reveals the true page color underneath. No sampled band, no wrong color.
- On cancel/commit, re-render just that page from pdf.js to restore pixels (the workspace already has a per-page re-render path used after annotation commits — reuse it).

For pages with imagery/gradients under the text (rare in legal docs but possible), the hole will show the page-color surface not the image. That's an acceptable trade because (a) it's still visually calmer than a mis-sampled band, and (b) after the user commits, the export pipeline uses pdf-lib's real redaction cover with the sampled bg for the final PDF — the edit-time preview doesn't have to be pixel-perfect.

### 4. Keep the export path unchanged
`exportEditedPdf` still writes the cover as an opaque rectangle in the output PDF using the stored `bg` — that's needed for the exported file to hide the burned-in glyphs. So we still sample and store `bg` on the anno; we just don't *paint* it during editing. Export behavior is untouched.

## Files touched

- `src/components/workspace/editor-canvas.tsx`
  - `onClickEditHit`: use `it.color` directly; keep `samplePageBg` for the stored `bg` only.
  - Add `clearRect` on the page canvas for the cover region; track cleared rects per anno id so cancel/commit can trigger a page re-render.
  - Cover element render: `background: transparent`.
  - Remove `sampleTextColor` (dead code).
- No changes to `state.ts`, export pipeline, or sidecar shape.

## Verification

- Dark-teal "STEP 1: The AI Audit System" heading → click → text stays white, no light band appears, original glyphs gone.
- Plain white page, black body text → click → text stays black, hole reveals white page, no visible seam.
- Cancel edit → original glyphs restored via page re-render.
- Export the edited doc → output PDF still has the opaque cover + new text (unchanged behavior).
- All 34 tests remain green.
