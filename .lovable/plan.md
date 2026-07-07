# Fix large-doc crashes and lag in the Redact panel

Two separate performance bugs to fix. Neither touches the PDF viewer / open-tab lifecycle / editor-canvas / samplePageBg.

## 1) Crash: "Wipe form fields" + "Apply redact" on a 5000-page PDF

**What happens today** (`tool-panels.tsx` apply-now branch, ~L1508–1588):
1. `sanitizePdfBytesWithReport(srcBytes)` — pdf-lib parses the whole 5000-page document on the main thread, walks `enumerateIndirectObjects()` three separate times, then re-saves the whole file.
2. Immediately after, `verifyRedactionRemoval(cleaned, sideTargets)` runs. Because the wipe has no page-rect targets, it skips geometry but still calls `verifyRawStreams` on the entire cleaned document (another full parse of all 5000 pages).
3. Both live buffers (`srcBytes` + `cleaned`) plus pdf-lib's parsed object graph are held in memory simultaneously → main-thread lockup → tab OOM.

**Fix**

1. **Move sanitize off the main thread.** Add `src/lib/workers/sanitize.worker.ts` that hosts `sanitizePdfBytesWithReport` (bytes in, `{bytes, report}` out, `Transferable` on both ends). Add a thin `src/lib/workers/sanitize-client.ts` wrapper mirroring `detect-pii-client.ts`. Replace the direct import in `tool-panels.tsx` with the client. Show a `toast.loading` with a Cancel button that terminates the worker.
2. **Free memory eagerly.** Before dispatching `LOAD` with `cleaned`, null out the local reference to the old `srcBytes` and use `postMessage(bytes, [bytes.buffer])` so the worker gets the buffer via transfer rather than structured clone.
3. **Skip full-doc verification for side-channel-only wipes.** In `tool-panels.tsx`, when `regionTargets.length === 0` and the wipe is form-fields / annotations / metadata only, replace the current `verifyRedactionRemoval(cleaned, sideTargets)` with a targeted check that reads only the `SanitizeReport` counters + a small `verifySideChannelVectors(cleaned, sensitiveStrings)` call (already exists in `verify-redaction.ts`). Don't re-parse every page. Full raw-stream verification is unnecessary here because sanitize deletes the containing indirect objects.
4. **Chunk the pdf-lib object walks.** In `sanitize.ts`, wrap the three `enumerateIndirectObjects()` loops (widget purge, hidden-layer/OC scan, JS/filespec scan) in a shared helper that `await yieldToUI()` (already in `src/lib/pdf/yield.ts`) every ~2 000 objects — inside the worker this simply relinquishes the microtask queue but also lets a Cancel signal short-circuit.
5. **Progress + cancel.** Worker emits `{kind:"progress", stage, done, total}`. UI shows `Wiping hidden data — N/M objects` and a Cancel button. On cancel the worker throws `AbortError` and the UI leaves `srcBytes` untouched.

## 2) Lag: clicking "Select all" then expanding the pages panel

**What happens today** (`tool-panels.tsx` ~L1873–2086):
- The findings list renders every group inline; each row calls `selected.has(d.id)` and recomputes `selCount = g.dets.reduce(…)` on every render.
- Toggling any checkbox rebuilds `selected` with `new Set(prev)`, which re-renders the whole tree; on 5000 pages / thousands of groups every keystroke re-walks every group.
- The "expanded pages" list under a group renders every occurrence in one flat `<ul>` — with a few thousand occurrences the browser stalls on layout.

**Fix**

1. **Memoize the derived selection state.** Compute a `selectionByGroup: Map<groupKey, {sel:number, total:number}>` inside a `useMemo` keyed on `[grouped, selected]`. Rows read from the map instead of reducing.
2. **Split rows into `React.memo` components.** `GroupRow` and `OccurrenceRow` receive only their own detection + a `checked` boolean + stable `onToggle`. Toggling one row no longer re-renders siblings.
3. **Virtualize the two long lists.** Use `react-window`'s `FixedSizeList` for (a) the main grouped `<ul>` when total groups > 200 and (b) the "expanded pages" occurrence list when `g.dets.length > 50`. Keep the small-list rendering path unchanged so nothing regresses on typical docs.
4. **Cap the initial expansion.** Keep the existing `SAMPLE = 10` behaviour but move "show all" behind a virtualized list — no more mounting 5 000 `<li>`s at once.
5. **Cancel-safe select-all.** `setSelected(new Set(redactableFindings.map(...)))` on 100 K findings is fine, but wrap it in `startTransition` so the checkbox flip feels immediate and the tree re-renders in the background.

## Files touched

- `src/lib/workers/sanitize.worker.ts` (new)
- `src/lib/workers/sanitize-client.ts` (new)
- `src/lib/pdf/sanitize.ts` — add `onProgress` + `shouldAbort` hooks + `yieldToUI` yield points
- `src/components/workspace/tool-panels.tsx` — apply-now branch uses worker + targeted verify; findings list refactor + `react-window`
- `bun add react-window @types/react-window` (only if not already installed — verify first)

## Verification

- Open a 5 000-page test PDF, run Redact scan, click "Wipe hidden items" — main thread stays responsive, toast shows progress, no OOM, srcBytes swapped.
- Cancel mid-wipe — document unchanged, no half-written state.
- Same doc: "Select all" → expand a group with thousands of occurrences → no visible lag, scrolling smooth.
- Small doc (≤ 50 pages): unchanged UI, identical behaviour (virtualization off, no worker overhead visible).

## Explicit non-goals

- No changes to the PDF viewer, tab lifecycle, editor-canvas, or `samplePageBg`.
- Destructive page-rect redaction path is untouched — this only fixes the hidden-vector wipe + list rendering.
