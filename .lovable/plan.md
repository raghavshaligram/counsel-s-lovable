## Plan — split heavy work into dedicated workers + aggressive memory release

### Goals
- Each heavy redaction step runs in its OWN dedicated Web Worker (isolated address space, terminated when done → OS reclaims memory immediately).
- No large PDF byte buffer stays in main-thread memory once a worker owns it.
- The freeze on select-all 13,000 findings + the confusing wipe message both get fixed.

### 1. One worker per task (isolation = free memory on terminate)

Today there’s a sanitize worker, a Bates worker, and a PII scan worker. Redact export still runs on the main thread. I’ll add small, single-purpose workers and reuse the ones we have. Each worker is spawned per job and **terminated the moment it returns**, so its entire heap is released.

New workers:
- `rasterize.worker.ts` — page-by-page rasterization of redacted pages (pdf.js render + black rects + JPEG encode + pdf-lib page swap). Streams one page at a time and frees canvas/JPEG after each page.
- `verify.worker.ts` — `verifyRedactionRemoval` (page geometry + raw stream + side-channel scan).
- `pixel-verify.worker.ts` — only spawned when pages were rasterized. Does the burned-pixel check (deterministic black-pixel coverage, no Tesseract) then terminates.
- `export.worker.ts` — runs `exportEditedPdf` (pdf-lib copyPages + annotation draw + text-rewrite surgery).

Reuse existing:
- `sanitize.worker.ts` (already exists) — called by the gate.
- `bates.worker.ts` (already exists).
- `detect-pii.worker.ts` (already exists).

Orchestrator:
- New `redaction-pipeline-client.ts` on the main thread runs the sequence: export → rasterize → sanitize → verify → (if leaks) rasterize-fallback → verify-again → (if any pages rasterized) pixel-verify. Between steps it transfers the `ArrayBuffer` to the next worker and **immediately terminates the previous one** so memory drops before the next step starts.

### 2. Memory release rules (applied everywhere)

- Always send bytes with `postMessage(msg, [buffer])` transfer — never structured-clone copy.
- After receiving bytes back from a worker, `worker.terminate()` inside the same tick before starting the next step.
- Never keep two full copies of the PDF alive at once (no `bytes.slice()` unless the next step truly needs the original — and if it does, drop the original reference right after).
- Inside each worker: after `pdf-lib` save, null out the doc reference; after pdf.js `getDocument`, call `destroy()` in a `finally`.
- Rasterize worker: null the canvas + JPEG bytes at end of each page loop iteration (already done — keep and audit).
- Main-thread editor: when the redaction commit completes, drop `lastBytes` state to `null` after the download starts so the browser can GC the redacted copy.
- Add a small `releaseBytes(u8)` helper that zero-length-slices and nulls references, used at every hand-off boundary.

### 3. Pixel verification: stop doing 13,000 OCR passes

Replace the Tesseract per-region OCR with a deterministic black-pixel check inside `pixel-verify.worker.ts`:
- For each rasterized page, sample the pixels inside every redaction rect (via `OffscreenCanvas.getImageData`).
- Pass if ≥ 99.5% of pixels are near-black. Fail otherwise.
- No Tesseract worker, no model download, O(pixels) not O(rects × OCR).
- The existing raw-stream + side-channel verification in the verify worker still proves no extractable text remains, so this is the right complement.

### 4. Fix the confusing wipe toast

- Rewrite `sanitizeStageLabel` to plain legal language: “form fields”, “comments”, “metadata”, “attachments”, “hidden layers”, “auto-open triggers”. Never say “javascript”, “scripts”, or “objects”.
- Change `(4,000 objects)` to `(checked 4,000 items)`.
- Change the bottom line to `Cleaning hidden document data…` when the specific stage isn’t known.

### 5. Keep the safety contract intact

- Staging still uses `ADD_ANNOS` batch (unchanged).
- Dedupe against existing redaction keys still runs before staging (unchanged).
- The final commit still goes through the SAME verified gate; the only change is that each stage of the gate now runs in its own worker with the previous worker terminated.
- If any verification step fails, download is blocked exactly as before.

### Files

New:
- `src/lib/workers/rasterize.worker.ts` + `rasterize-client.ts`
- `src/lib/workers/verify.worker.ts` + `verify-client.ts`
- `src/lib/workers/pixel-verify.worker.ts` + `pixel-verify-client.ts`
- `src/lib/workers/export.worker.ts` + `export-client.ts`
- `src/lib/editor/redaction-pipeline-client.ts` (orchestrator)
- `src/lib/workers/release.ts` (`releaseBytes` helper)

Edited:
- `src/components/workspace/tool-panels.tsx` — `RedactPanel.exportRedacted` calls the new orchestrator; updates `sanitizeStageLabel` + toast wording.
- `src/components/workspace/export-dialog.tsx` — same orchestrator for redaction path.
- `src/lib/editor/redaction-gate.ts` — thin wrapper that delegates to the workers (kept as the single chokepoint).
- `src/lib/editor/verify-pixel-redaction.ts` — swap OCR for black-pixel check (moved into worker).

### Why this fixes the freeze
- No PDF parsing, rasterization, sanitize, or verify runs on the main thread — UI stays responsive.
- Each worker is terminated after its step, so peak memory is one worker’s heap at a time instead of accumulating across steps.
- Removing Tesseract from the pixel check kills the biggest CPU/memory cost for large selections.

### What the current bottom message means
`Wiping embedded scripts… (4,000 objects)` is the sanitizer walking internal PDF structures to remove hidden triggers — not a JavaScript app error and not a memory-freeing message. The new wording will make that obvious.