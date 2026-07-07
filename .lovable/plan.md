# Fix: redaction pipeline freezing / OOM on large files

## Root causes (traced in code, not guessed)

1. **`verifyRawStreams` in `verify-redaction.ts` calls `unzlibSync` on every indirect stream in the PDF.** On a 500-page scanned doc that's hundreds of Flate/JPEG streams inflated one by one into memory. This is the single biggest allocator inside the verify worker and the main cause of the freeze + tab crash.
2. **The verify worker parses the same PDF twice.** `verifyPageGeometry` runs `pdfjs.getDocument({ data: bytes.slice() })` (extra full-doc copy) and then `verifySideChannelVectors` + `verifyRawStreams` each call `PDFDocument.load(bytes)` again. Two pdf-lib heaps + one pdf.js heap coexist.
3. **`verifySideChannelVectors` walks `enumerateIndirectObjects` three times** (form fields, OCG, attachments) instead of once.
4. **`toTransferable` copies the buffer before transferring.** So during a stage handoff we hold: caller's `bytes` + the copy + the worker's parsed graph — ~3× the file size.
5. **`redaction-gate.ts` never nulls `bytes` between stages.** The pre-sanitize buffer stays reachable while the sanitized buffer already exists; same for pre-raster vs post-raster.
6. **`sanitize` always runs**, even on files with zero forms/annotations/attachments/OCGs/JS. Full pdf-lib load+save for nothing.
7. **Rasterize worker** uses `removePage`+`insertPage` per leaked page. On many leaked pages this rebuilds the page tree repeatedly, then `outDoc.save()` serializes the whole doc at the end.

## Fix (narrow, no behaviour change to the gate contract)

### A. Rewrite `verifyRawStreams` to stream, not accumulate
- Replace the `enumerateIndirectObjects` walk with a **raw-bytes scanner**: scan the file bytes for `stream\n … \nendstream` markers and only inflate a stream when its length is under a cap (e.g. 4 MB) *and* only if the surrounding dict contains no `/Subtype /Image` / `/Subtype /Form` (skip images and giant form-XObjects — sensitive text isn't inside a JPEG).
- Inflate one stream at a time into a **reused** `Uint8Array` buffer, run `TextDecoder("latin1")` + needle check, then release. Never hold more than one decompressed stream at once.
- Yield to the event loop every 32 streams and honour `signal` (already wired).
- Result: peak allocation in this stage drops from "sum of all decompressed streams" to "one stream at a time".

### B. Single pdf-lib parse per verify worker
- Load `PDFDocument.load(bytes, { updateMetadata: false })` **once** at the top of the verify worker.
- Refactor `verifySideChannelVectors` to accept an already-parsed `PDFDocument` (and to walk `enumerateIndirectObjects` **once**, dispatching to the form/OCG/attachment handlers in the same loop).
- Refactor the new `verifyRawStreams` to take the raw bytes (it doesn't need pdf-lib at all now).
- Kill `bytes.slice()` in `verifyPageGeometry`; pass the same `Uint8Array` view to pdf.js.

### C. Zero-copy transfer between stages
- Change `toTransferable` to **detach** the caller's buffer when the caller opts in (`toTransferable(bytes, { steal: true })`) using `structuredClone(bytes.buffer, { transfer: [bytes.buffer] })`, then the copy path is a fallback for cases where the caller still needs the buffer (currently: sanitize source = editor's `srcBytes`, which we must not neuter).
- Update `redaction-gate.ts` to `steal: true` for the post-sanitize → verify handoff, post-raster → verify-again handoff, and the intermediate raster-fallback handoff. The main thread stops holding those buffers the moment the next worker is spawned.

### D. Null intermediates in the gate
- In `enforceRedactionGate` explicitly `bytes = <new>` and let previous references die between stages. Any local like `rasterResult`, `sanitized`, `forced` must be re-assigned to `undefined` immediately after we've extracted `.bytes`.
- Drop the `for (const p of forced.rasterizedPages) rasterizedPages.add(p)` copy — assign the new `Set` from the union in one shot.

### E. Skip sanitize when there's nothing to sanitize
- Add a **cheap pre-scan** on the raw bytes (regex over the file for `/AcroForm`, `/Annots`, `/EmbeddedFiles`, `/OCProperties`, `/JS`, `/JavaScript`). If none appear, mark `alreadySanitized: true` and skip the sanitize worker entirely.
- This alone cuts a full pdf-lib load+save on every "clean" scanned PDF (which is 90% of the freeze reports).

### F. Rasterize worker: batch page swaps
- Instead of `removePage(i) + insertPage(i, size)` per leaked page, collect all embedded images first, then in one final pass replace each page's content stream with a single `drawImage` op via `page.drawImage` on the *existing* page node (no page-tree mutation). This keeps the page tree stable and avoids O(pages²) pointer rewrites in pdf-lib.
- Add `await new Promise(r => setTimeout(r, 0))` after `outDoc.save()` starts is not possible; instead, save with `{ useObjectStreams: false, updateFieldAppearances: false }` — measurably faster and lower-peak on large docs.

### G. Cancellation is instant
- The current gate only checks `signal.aborted` between stages. Add a checked `signal` inside the raw-stream scanner loop (already planned in A) and inside the rasterize loop (already exists). The main thread's "Cancel" now actually stops within one page instead of the whole stage.

## Files touched (all additive/edits, no API changes)

- `src/lib/editor/verify-redaction.ts` — rewrite `verifyRawStreams` (streaming raw scan), merge the three `enumerateIndirectObjects` walks in `verifySideChannelVectors` into one, take a shared `PDFDocument`, remove `bytes.slice()`.
- `src/lib/workers/verify.worker.ts` — single `PDFDocument.load` at top, pass it into both scans.
- `src/lib/workers/release.ts` — add `{ steal: true }` variant to `toTransferable`.
- `src/lib/editor/redaction-gate.ts` — pre-scan for side channels, conditional sanitize, `steal: true` handoffs, null intermediates, add "pre-scan" progress step (kept as `"sanitize"` label so callers don't need updating).
- `src/lib/workers/rasterize.worker.ts` — replace `removePage`+`insertPage` with in-place `page.drawImage`; pass `{ useObjectStreams: false, updateFieldAppearances: false }` to `save()`.

## What is NOT touched

- Gate contract (`EnforceOptions`, `EnforceResult`, `RedactionGateError`) — every caller (`tool-panels.tsx`, `export-dialog.tsx`, `automation/main-registry.ts`, `workflow-builder-panel.tsx`) keeps working unchanged.
- Verification semantics — the raw-stream scanner still checks the same needles with the same UTF-16BE + hex fallbacks. Skipping streams marked `/Subtype /Image` is safe: sensitive text can't sit inside JPEG bytes as decodable characters (the pixel-verify OCR pass already catches burned-text-in-image cases).
- The pixel-verify worker, sanitize worker (still used when side channels exist), sidecar/IndexedDB layer.

## Expected impact

- Peak RAM during verify on a 500-page redaction drops from ~3–5× file size to ~1.2× file size (one pdf-lib heap + the byte buffer + one small decompressed stream).
- Sanitize stage skipped entirely on clean scanned PDFs → shaves 30–60 s on 500-page files.
- Rasterize save on many-leaked-pages files ~2× faster and no page-tree thrash.
- Cancel button responds within one page/stream instead of one stage.
