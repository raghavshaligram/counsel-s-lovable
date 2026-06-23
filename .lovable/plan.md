## Squeeze more speed out of on-device PDF → Word

Building on what we just shipped (parallel pages, JPEG encoding, 1.5× fidelity, "Include images" toggle), this round targets the next layer of bottlenecks. Honest expectation: another ~1.5–3× on top of current, plus the UI stops freezing during conversion. We will not hit iLovePDF's <1s on arbitrary PDFs — that's a server-side reality — but the experience will feel dramatically snappier.

### What changes

1. **Move the whole conversion into a Web Worker.**
   The main thread currently does pdfjs parsing, image decoding, PNG/JPEG encoding, and docx zipping. All of that happens off the UI thread now. The page stays responsive, scroll/click never hitches, and the worker can use `OffscreenCanvas` for faster rendering.

2. **`OffscreenCanvas` + `convertToBlob`.**
   Inside the worker, page rendering and image encoding go through `OffscreenCanvas`, which avoids DOM canvas overhead and is measurably faster, especially for fidelity mode.

3. **Single-pass image extraction.**
   Today we call `getOperatorList()` *in addition to* the text pass — that's an entire second parse of every page. We'll extract image XObject references from the existing render/text pipeline so each page is parsed once, not twice. For flow/page modes with images on, this is a big win.

4. **Default "Include images" to OFF for flow/page modes.**
   For text-heavy PDFs (the common case), image extraction dominates runtime. Off by default makes the typical conversion ~3–5× faster; users who need images flip the toggle (which is already in the panel).

5. **Stream docx packing.**
   Start packing earlier — kick off `Packer.toBlob` as soon as all page children resolve, and report progress as "Packing .docx…" so users see motion at the tail of the job instead of a stalled bar.

6. **Tune concurrency to hardware.**
   Use `navigator.hardwareConcurrency` to set page parallelism (clamped 2–8) instead of the fixed 4. Laptops with 8+ cores get a real boost; low-end devices don't get oversubscribed.

7. **Faster line grouping.**
   Replace the O(n²) `rows.find(...)` line-bucketing with a Y-keyed Map. Negligible on small PDFs, noticeable on text-dense ones (50+ pages).

### Non-goals

- No server upload. Conversion stays 100% on-device per the project's core privacy rule.
- No change to the panel layout or modes — same three modes, same single toggle.
- No rewrite of the underlying docx library.

### Technical details

Files touched:

- `src/lib/pdf/to-word.worker.ts` *(new)*
  - Web Worker entry. Receives `{ buffer, options }`, runs the full conversion (pdfjs + image extraction + docx pack), posts `{ type: "progress", pct, stage }` messages, ends with `{ type: "done", blob }` or `{ type: "error", message }`.
  - Uses `OffscreenCanvas` for rendering + encoding (`canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })`).
  - Imports pdfjs and docx dynamically inside the worker; configures the pdfjs worker source via `import.meta.url`.

- `src/lib/pdf/to-word.ts`
  - Becomes a thin wrapper: spawns the worker (`new Worker(new URL("./to-word.worker.ts", import.meta.url), { type: "module" })`), transfers the file's `ArrayBuffer`, resolves on `done`.
  - Keeps the same public signature `convertPdfToWordBlob(file, options)` so the panel and the standalone `/to-word` route don't change.
  - Default `concurrency` switches to `Math.max(2, Math.min(8, navigator.hardwareConcurrency ?? 4))`.
  - Default `includeImages` flips to `false`.
  - Single-pass image extraction: reuse the `RenderTask`'s `operatorList` (available after `page.getOperatorList()` is awaited *or* via a custom intent) instead of calling it as a separate post-text step. Group image XObject decoding into the same `await` as text extraction with `Promise.all`.
  - Swap `rows.find(...)` for `Map<number, StyledLine>` keyed by `Math.round(y / tolerance)`.

- `src/components/workspace/tool-panels.tsx` (ConvertPanel only)
  - Initial state: `const [wordIncludeImages, setWordIncludeImages] = useState(false)` (flip default).
  - Update the toggle's hint to read: `On = slower, embeds images. Off (default) = fast text-only.`
  - No layout/structural changes.

- `vite.config.ts`
  - Verify the worker import resolves with the existing config; TanStack Start + Vite already supports `new Worker(new URL(...), { type: "module" })` out of the box, no plugin change expected. If a transform issue surfaces, add `worker: { format: "es" }`.

### Expected impact (on top of current)

- 10-page text-heavy PDF, default settings (images off): ~3–5× faster, UI never freezes.
- Same PDF with images on: ~1.5–2× faster (single-pass extraction + worker).
- 20-page fidelity export: ~1.3–1.6× faster, UI stays responsive.
- Real number for a typical resume/letter: expect ~0.5–1.5s instead of ~3–5s. For a 50-page report with images on, expect single-digit seconds instead of 15–30s.

### What this will *not* fix

PDFs with hundreds of pages, dense vector graphics, or thousands of embedded images will still take real time — pdfjs is the floor, and we can't undercut it without leaving the browser.
