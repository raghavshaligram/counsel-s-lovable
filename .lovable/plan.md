## Repeated open/close stall — root cause and fix (shipped)

### Root cause

All tabs used one shared pdf.js Web Worker (spawned from
`GlobalWorkerOptions.workerSrc`). `closeTab` did fire-and-forget
`doc.destroy()`, and per-page `RenderTask`s from `EditorPages` and
`nav-overlay` thumbnails were never cancelled before unmount — so
destroy waited on orphaned renders and pinned the singleton worker.
After ~4 open/close cycles the worker's queue was jammed; the 5th
`getDocument()` never resolved. `resetPdfjs()` only nulled the local
module cache, so the browser's ESM cache handed back the same wedged
worker on retry.

### Fix (all shipped)

1. **Per-document PDFWorker** (`src/lib/pdf/worker.ts`)
   - `createPdfWorker()` returns a fresh `new pdfjs.PDFWorker()` per open.
   - `destroyPdfWorker()` awaits graceful `destroy()` with a 1.5s race,
     then unconditionally `terminate()`s the Worker thread.
   - `withPdfjsWatchdog(task, ms, onTimeout, worker?)` now terminates
     the doc's dedicated worker on timeout before rejecting.
   - `resetPdfjs()` kept as a no-op export for back-compat.

2. **Per-doc worker ownership** (`src/components/workspace/workspace-shell.tsx`)
   - `pdfDocsRef` stores `{ doc, worker }` per tab id.
   - Open path (`useEffect`) and `replaceActivePdfBytes` create a fresh
     worker, pass it via `pdfjs.getDocument({ data, worker })`, and
     store the pair. On cancel/timeout the worker is terminated.
   - **Parse-once invariant preserved**: the "already loaded" guard
     still short-circuits when the tab has a live pdfDoc; the doc is
     shared with `EditorPages` and `NavOverlay` via the same ref.

3. **Cancel render tasks before unmount** (`src/components/workspace/nav-overlay.tsx`)
   - `PageThumb` tracks the active `RenderTask`, calls `.cancel()` on
     effect cleanup, and swallows `RenderingCancelledException`. This
     lets `doc.destroy()` resolve immediately during tab close.
   - `EditorPages` already cancelled its render tasks
     (`editor-canvas.tsx` ~309); left as-is.

4. **Tighter close sequencing** (`closeTab`)
   - Await `doc.destroy()` with a 1.5s race, then `destroyPdfWorker()`
     the tab's dedicated worker.
   - New `closingTabsRef: Set<string>` — the open effect skips any
     tab id whose teardown hasn't settled, so a fresh parse can never
     queue behind a half-destroyed doc/worker.

### Verification

Playwright stress test at `/tmp/browser/openclose/run.py`:
open → close the same PDF 10 times in a row.

    cycle  1: OK  open=1.06s
    cycle  2: OK  open=0.68s
    …
    cycle 10: OK  open=0.66s
    SUMMARY: 10/10 cycles passed

Previously wedged on cycle 5. Open time stays sub-second across all
cycles, no worker termination or unrelated errors surfaced.

### Files touched
- `src/lib/pdf/worker.ts`
- `src/components/workspace/workspace-shell.tsx`
- `src/components/workspace/nav-overlay.tsx`

Not touched: engine, sidecar, NER worker, storage-audit code, batch
ops, other routes that still use the global worker (`/compare`,
`/organize`, `/ocr`, etc. run one doc at a time and are not part of
the workspace open/close lifecycle).
