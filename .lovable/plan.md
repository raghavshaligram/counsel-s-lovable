
# Fix: Bates Hangs on 5000-Page Apply + Double-Stamps on Export

Two separate root causes, one behind each symptom.

## 1. Why "Apply to active tab" hangs on 5000 pages

Three main-thread passes over the whole document happen back-to-back:

1. `addBates` in `src/lib/batch/ops/bates.ts` — pdf-lib parses all 5000 pages, draws a rectangle + text on each, then `doc.save()` re-serializes. Yields only every 16 pages.
2. `replaceFile(new File([out], …))` swaps the tab's file, which retriggers the workspace's open/parse pipeline for the new 5000-page bytes.
3. **The certificate probe** at `BatesSection.run` (tool-panels.tsx line 7347–7351) does *another* full parse: `pdfjs.getDocument({ data: new Uint8Array(out).slice() })` just to read `numPages` — and it clones the entire byte array first. On 5000 pages this alone is multi-second, main-thread, no yields.

Steps 1 + 2 are unavoidable work but should not lock the UI. Step 3 is pure waste — we already know the page count without opening the file.

**Fix.**

- **Kill the redundant pdf.js probe.** Replace it with the page count we already have from the loaded editor doc (`editorState.doc.pages.length`) or, on the download path, from pdf-lib's `PDFDocument.load().getPageCount()` — which is basically free because it doesn't hydrate pages. Have `addBates` return `{ bytes, pageCount }` so we never re-parse.
- **Move `addBates` off the main thread.** Add `src/lib/workers/bates.worker.ts` + `src/lib/workers/bates-client.ts` mirroring the sanitize worker pattern we already ship. `addBates` accepts a signal + `onProgress`; the client shows a `toast.loading` with Cancel and updates progress every ~200 pages.
- **Yield more aggressively inside the loop.** Change `maybeYield(i, 16)` → `maybeYield(i, 64)` (worker + yield keeps UI responsive without a big cost per yield).
- **Guard the tab swap.** `replaceFile` after a big stamp should show a "Loading stamped document…" state so the user knows the tab is intentionally re-opening.

## 2. Why export stamps Bates a second time

In `src/components/workspace/export-dialog.tsx` (lines 48, 110–115) the "Bates" toggle in the export dialog is read from the shared bates store (`useBatesSettings`) and unconditionally stamps if `bates.on` is true — regardless of whether the tab bytes were **already stamped** via "Apply to active tab."

There is no "already applied" flag. So the flow is:

1. User applies to active tab → bytes now contain Bates numbers.
2. Bates store still has `on: true` (or the toggle is on in the export dialog).
3. Export dialog runs `addBates` again → second row of numbers layered over the first.

**Fix.**

- **Track applied state per document.** Add `appliedAt?: number` (timestamp) and `appliedFingerprint?: string` to the bates settings record in `src/lib/workspace/bates-store.ts`. Fingerprint = a hash of the settings that were applied (prefix + suffix + startAt + digits + position + fontSize + color + margin).
- **Set it in `BatesSection.run`** after a successful "Apply to active tab" and clear it whenever the user edits any setting (settings change → fingerprint mismatch → allowed to stamp again).
- **In the export dialog:**
  - If `appliedAt` is set AND the current settings fingerprint matches, **default `batesOn` to false** and show a small note: *"Bates already stamped on this document — enable to stamp again."*
  - If the user explicitly re-enables the toggle after that note, we still stamp (their call, e.g., to add a second series). No silent double-stamps.
- **Belt and braces on the export path.** When `batesOn` is true and `appliedFingerprint` matches the settings we're about to stamp with, skip the `addBates` call and log a `console.info` line so the behavior is auditable.

## Files touched

- `src/lib/batch/ops/bates.ts` — return `{ bytes, pageCount }`; loosen yield cadence.
- `src/lib/workers/bates.worker.ts` (new), `src/lib/workers/bates-client.ts` (new) — off-main-thread runner with progress + cancel.
- `src/components/workspace/tool-panels.tsx` `BatesSection.run` — use worker client; remove the pdf.js probe; use returned `pageCount`; set `appliedAt`/`appliedFingerprint` on success.
- `src/lib/workspace/bates-store.ts` — add `appliedAt`, `appliedFingerprint`; helper `computeBatesFingerprint(settings)`; clear the applied state when relevant settings change.
- `src/components/workspace/export-dialog.tsx` — read applied state; default toggle off + show note when fingerprint matches; skip stamping when fingerprint matches AND toggle wasn't manually re-enabled.

## Not doing

- Not touching the PDF viewer, tab lifecycle, editor-canvas, or samplePageBg (per project constitution).
- Not changing the standalone `/bates` route or multi-file Bates flow — the fix is scoped to the workspace inspector + workspace export.
- No cloud offload. Everything stays on-device, in a Web Worker.

## Verification

- 5000-page PDF: "Apply to active tab" completes without a UI hang; progress toast counts up; Cancel actually cancels.
- Immediately after apply, opening the export dialog shows the "already stamped" note and Bates toggle off by default.
- Export with defaults → output has exactly one row of Bates numbers.
- Change any Bates setting → note disappears, toggle re-enables, export re-stamps as expected.
- Small doc (10 pages): behavior unchanged.

Approve and I'll implement.
