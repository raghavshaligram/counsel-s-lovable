## Speed up PDF → Word conversion

The current converter is slow because every page is processed sequentially, every embedded image and every fidelity-mode page is encoded as PNG (slow + huge), and fidelity mode renders at 2× even when it doesn't need to. Below is a focused set of changes that should cut conversion time roughly 2–5× depending on document type, with no UI redesign.

### What changes

1. **Process pages in parallel** with a small concurrency limit (4 at a time). Pages are independent — building each page's docx children in parallel and stitching them in order at the end gives a big speedup on multi-page PDFs.

2. **Encode images as JPEG, not PNG**, for both inline images (flow/page modes) and full-page rasters (fidelity mode). JPEG `toBlob` is dramatically faster and produces files 3–10× smaller. We'll keep PNG only for images with an alpha channel.

3. **Lower default fidelity scale to 1.5×** (was 2×). 1.5× is visually indistinguishable in Word at normal zoom and roughly halves render + encode time. Power users can still bump it.

4. **Skip image extraction in flow/page modes by default**, behind a new "Include images" toggle (on by default). The image-extraction pass walks the operator list and decodes every XObject — for text-heavy PDFs with lots of decorative images this dominates runtime. The toggle lets users opt out for a fast text-only pass.

5. **Cache the rendered page canvas in fidelity mode** so we render once and reuse instead of calling `getViewport`/`render` redundantly, and free the canvas immediately after `toBlob` to keep memory flat across pages.

6. **Show real progress** — switch progress reporting to count *completed* pages from the parallel pool, so the percentage actually advances during long jobs instead of jumping.

### Non-goals

- No web-worker rewrite (large change, marginal win on top of #1–#3).
- No change to the Convert panel layout or modes — same three modes, same buttons.
- Underlying conversion functions stay separate (per project rules).

### Technical details

Files touched:

- `src/lib/pdf/to-word.ts`
  - Add a `runWithConcurrency(tasks, limit)` helper; build a `pageChildren: any[][]` array indexed by page number, populate it in parallel, then flatten in order into `allChildren`.
  - Add `encodeCanvas(canvas, { preferJpeg })` that returns JPEG (`quality: 0.85`) unless the source has alpha, then PNG.
  - Change `renderPageToPng` → `renderPageToImage(page, scale)` returning `{ data, mime, width, height }`; default scale 1.5.
  - Change `extractPageImages` to use the same encoder and to early-exit when `includeImages` is false.
  - Extend `ToWordOptions` with `includeImages?: boolean` (default `true`) and `fidelityScale?: number` (default `1.5`).
  - Update `ImageRun` calls to pass `type: "jpg" | "png"` based on the encoder output.
  - Progress callback fires from a shared counter incremented as each page resolves.

- `src/components/workspace/tool-panels.tsx` (ConvertPanel only)
  - Add `const [includeImages, setIncludeImages] = useState(true)` and a small `Toggle` row inside the existing "Layout" Section when `kind === "pdf" && target === "word"` and `wordMode !== "fidelity"`.
  - Pass `includeImages` to `convertPdfToWordBlob`. No new section, no new rail — fits inside the existing inspector.

### Expected impact

- Text-heavy 20-page PDF, flow mode, images on: ~3× faster (parallelism + JPEG).
- Same PDF with "Include images" off: ~5× faster.
- 20-page fidelity export: ~2× faster (1.5× scale + JPEG encode).
