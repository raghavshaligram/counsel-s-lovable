## New signal (decisive)

You reproduced the crash by **switching tabs** with heavy files loaded. That rules the rest of the matrix out and points at tab lifecycle. Not SW/CSP/cache (site-data clear made no difference), not a single operation — it's what the app holds and re-does per tab.

## What's actually happening (confirmed from `workspace-shell.tsx`)

- Non-active tab pdfDocs **are** destroyed on switch (line ~862). Good.
- But each `TabState.editor.doc.srcBytes` is a Uint8Array that **stays resident for every open tab**, active or not. Heavy file × N tabs = N × file size in JS heap, permanently.
- On switch, the open-effect (~line 1264+) **re-parses** the incoming tab's bytes with `pdfjs.getDocument({ data: bytes, … })`. `pdfjs` clones `data` into its worker; while both live you briefly hold ~3× the file size. If a previous destroy hasn't finished, they overlap.
- Every switch remounts `EditorPages`, which lazily re-renders visible pages, warms text/image caches, and re-fires per-page workers. Under memory pressure these allocations trip OOM → tab dies (grey → crash).

So the crash is a compounding of: (1) all tabs' srcBytes held forever + (2) destroy/reparse overlap on switch + (3) re-render storm on the new tab.

## Diagnostic step (~15 min, no logic changes)

Add a **tiny probe** (`src/lib/debug/heap-probe.ts`, ~40 lines) exposing `sampleHeap(label)` + `startLongTaskWatch()`. Wire samples at:

1. Boot (baseline).
2. Just before/after `setActiveId` in `workspace-shell.tsx`.
3. Before/after the destroy call at line 867.
4. Before `pdfjs.getDocument(...)` at line 1307 and immediately after it resolves.
5. 5 s post-switch idle.

Also log `pdfDocsRef.current.size` and `Σ tab.editor.doc.srcBytes.byteLength` at each sample.

**Repro you run once:** open heavy file A, open heavy file B, switch A↔B three times. Copy the console tail (filter `heap|probe|longtask`).

## What the tail will tell us (and the fix each answer implies — no code this plan)

| Observation | Confirmed cause | Fix in next plan |
|---|---|---|
| Total srcBytes MB grows linearly with tabs opened | All tabs pinning bytes | Evict `srcBytes` for background tabs to IndexedDB; rehydrate on activate |
| Heap spikes to ~2× file during the switch window, drops after | Destroy/reparse overlap | Await previous `destroy()` before `getDocument`; sequence with a switch lock |
| Long task > 1 s at each switch, heap flat | Re-render storm on EditorPages remount | Debounce switch, keep `pdfDoc` for last N tabs, skip page-warm on activate |
| Heap never returns to pre-switch baseline | Retained refs (closures, workers, caches) | Audit `pdfDocsRef`, worker terminate, text/image caches |

Multiple can be true; the numbers rank them.

## Out of scope

- No changes to redaction burn/verify/gate.
- No SW, CSP, or pdf.js option changes.
- No fix commits this plan — only instrumentation and the repro. The follow-up plan picks exactly the fix the numbers justify.

## Deliverable from you

Console tail from the A↔B×3 repro. I map it to the table above and open a targeted fix plan.
