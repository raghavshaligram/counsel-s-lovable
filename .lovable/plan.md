## Why opening a doc gets stuck after a few open/close cycles

The 10-tab cap is not the problem — closing frees the slot. The real cause is in the **open path** and the **shared pdf.js worker**:

1. **Single shared pdf.js worker, process-wide.** `src/lib/pdf/worker.ts` caches one `pdfjs` module and one underlying Web Worker for the whole tab. Every open calls `pdfjs.getDocument({ data: bytes })` against that same worker. After several heavy documents (especially the recent 329-page NER run, which also spawns parallel `getDocument` calls inside `ner.worker.ts`), the pdfjs worker can be left with pending tasks / transferred buffers it never finishes. The next `getDocument` then hangs forever — a full page refresh recreates the worker, which is exactly the symptom you describe.

2. **Tab-close `destroy()` is fire-and-forget.** `closeTab` does `void doc.destroy?.()` (`workspace-shell.tsx` ~660). If destroy is in flight when you open a new file, pdfjs may queue the new parse behind the unfinished teardown.

3. **"Already loaded" check keys on filename only.** The open effect (`workspace-shell.tsx` ~912) skips parsing when `editor.doc.fileName === f.name`. If you close a tab and immediately re-open the same-named file in a fresh tab, parsing is skipped but `pdfDocsRef` has no entry for the new tab id → canvas stays blank and the tab looks "stuck".

4. **File input value isn't always reset.** Only `openNewStartTab` clears `fileInputRef.current.value`. From the dropzone label or `openFile()`, picking the same file twice fires no `change` event → silent no-op that feels like "stuck".

5. **No timeout / no error surface.** The open effect awaits `getDocument(...).promise` with no timeout and no user-visible state, so a hang is invisible.

## Fix plan (frontend only, no logic rewrites)

### 1. Self-healing pdf.js worker
- In `src/lib/pdf/worker.ts`, add `resetPdfjs()` that nulls the cache and re-imports next call.
- Wrap each `getDocument(...).promise` call site (`workspace-shell.tsx` lines 379, 933, 2801, plus `ner.worker.ts`) with a 30 s watchdog. On timeout: call `resetPdfjs()`, toast "Re-initialising PDF engine…", retry once. Eliminates the need to refresh the browser.

### 2. Await destroy before reusing the slot
- In `closeTab` and the open-effect's "replace prior" branch, `await` the `destroy()` promise (with a short timeout fallback). Prevents the next parse being queued behind half-destroyed state.

### 3. Tighten the "already loaded" guard
- Change the skip condition to `fileName === f.name && srcBytes.byteLength === f.size && pdfDocsRef.current.has(tabId)`. Forces a re-parse when the tab has no live pdfDoc, fixing the blank-canvas case after close/reopen of a same-named file.

### 4. Always reset the file input
- Set `fileInputRef.current.value = ""` inside `openFile()` and in the `<input onChange>` handler after reading `files`, not only in `openNewStartTab`. Picking the same file twice will always re-trigger.

### 5. User-visible open state + cancel
- Add a per-tab `isOpening` flag set true while `getDocument` is pending, false on success/error/timeout. Show a small "Opening…" indicator on the tab; on timeout show a toast with a "Retry" action that calls `resetPdfjs()` and reloads the file.

### 6. NER worker hygiene (precaution)
- In `src/lib/pdf/ner.ts`, add `terminateNerWorker()` and call it when no detection job has run for 60 s, or on tab close if it's the last document. Keeps the 110 MB model out of memory between sessions and prevents the NER worker from competing with pdfjs after a giant scan.

### Verification
- Open and close the 329-page PDF (or any heavy doc) 5–6 times in a row, including running AI Detect Sensitive on one of them. The 7th open should succeed without a browser refresh.
- Open `foo.pdf`, close the tab, immediately open `foo.pdf` again — canvas renders, no blank.
- Pick the same file twice in the dropzone — second pick re-loads instead of being ignored.
- Force a hang (throttle worker) — toast appears, retry recovers.

### Files touched
- `src/lib/pdf/worker.ts` — add `resetPdfjs`.
- `src/components/workspace/workspace-shell.tsx` — watchdog wrapper, awaited destroy, tightened guard, input-value reset, `isOpening` UI.
- `src/lib/pdf/ner.ts` — `terminateNerWorker` + idle timer.
- `src/lib/pdf/ner.worker.ts` — wrap its own `getDocument` calls with the same watchdog helper.
- `src/lib/workspace/tabs.ts` — add optional `isOpening?: boolean` to `TabState`.

No backend, no design-token, no business-logic changes.