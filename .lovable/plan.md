## Goal

Three-part hardening for the workspace under heavy load:

1. Block legacy browsers (IE10/11, Edge Legacy) at parse time with a compliance modal.
2. Catch memory / quota runtime failures and surface a recoverable banner with a one-click refresh.
3. Run a deterministic `cleanupWorkspaceState()` before every PDF load/swap so the previous file's worker, canvases, and blob URLs are released — fixing the freeze-on-second-PDF.

## 1 · Legacy Browser & IE Mode Detection

Modern Vite bundles do not parse on IE, so the existing React `UnsupportedBrowserGate` never mounts. The block must run before any module script.

**Edit `src/routes/__root.tsx` → `RootShell`** to inject a single inline ES5 `<script>` as the first child of `<body>` (plus a `<noscript>` twin):

- Detect: `/MSIE |Trident\//.test(ua)` (IE10/11) OR `/Edge\/\d+/.test(ua)` (Edge Legacy / EdgeHTML — modern Chromium Edge reports `Edg/` so it is not matched).
- On match: lock `documentElement.style.overflow = 'hidden'`, create a full-viewport overlay (`position:fixed; inset:0; z-index:2147483647`) and append to `document.body`.
- Strict ES5 only (no `const`, arrows, template literals, `Object.assign`).

**Modal visual** — clean enterprise card, system font stack:

- White card `#FFFFFF`, 4px top border `#B91C1C` (compliance red), subtle 1px hairline border `#E5E7EB`, dark backdrop `rgba(14,17,22,0.72)`.
- Eyebrow: `⚠ COMPLIANCE ALERT · INSECURE ENGINE DETECTED` (uppercased, letter-spaced, red `#B91C1C`).
- Headline (dark `#0E1116`, 20px/600): "This secure legal workspace cannot run on this browser engine."
- Body (`#374151`, 14px/1.6): "You are trying to access this secure legal workspace using an unsupported or legacy browser framework. Legacy engines do not support modern client-side sandboxing. Running privileged client documents on obsolete engines risks data leakage and violates standard legal data compliance rules."
- Action row: three pill links — **Microsoft Edge**, **Google Chrome**, **Mozilla Firefox** — pointing to official download pages, `target="_blank" rel="noopener"`.
- Footer microcopy (`#6B7280`, 12px): "Your documents are processed on-device. We can only guarantee that on a modern browser."

**Keep** `src/components/unsupported-browser.tsx` as a defensive second layer for any Trident-like UA that still parses the bundle.

## 2 · Memory / Quota Exception Handling

**New file `src/lib/runtime-pressure.ts`** — tiny module booted from `__root.tsx`'s existing `useEffect`:

- Subscribes to `window.addEventListener('error', …)` and `window.addEventListener('unhandledrejection', …)`.
- Classifier matches any of: `/QuotaExceeded/i`, `/NS_ERROR_DOM_QUOTA/i`, `/out of memory/i`, `/Array ?Buffer/i`, `/Maximum call stack/i`, `/Failed to allocate/i`, IndexedDB `AbortError` with `quota`, pdf.js `"Worker was destroyed"` after a swap.
- On classify: dispatches `CustomEvent('counselpdf:memory-pressure', { detail: { reason } })`. Debounced 5s so a flood of follow-ups raises one banner.
- Also exposes `reportMemoryPressure(reason)` so the PDF open path can fire it manually when `pdf.getDocument` rejects with a heap-pressure signal (caught in `workspace-shell`).

**New component `src/components/workspace/memory-pressure-banner.tsx`**, mounted inside `WorkspaceShell` above the canvas:

- Listens for the custom event, shows a top-of-workspace banner.
- Soft amber: bg `#FEF3C7`, border `#FCD34D`, text `#78350F`, 13px.
- Copy: "**Notice:** Document transition data limit reached. If you cannot upload or your new PDF fails to open, please [Refresh Browser] to purge local cache memory."
- `[Refresh Browser]` is a `<button>` styled as an inline pill that calls `window.location.reload()`. Also offers a Dismiss "×".
- ARIA: `role="status"`, `aria-live="polite"`. Auto-dismisses after 30s if the user takes action that succeeds (next successful PDF load fires `counselpdf:memory-pressure-clear`).

## 3 · `cleanupWorkspaceState()` — Preventative Lifecycle Cleanup

The freeze cause: `workspace-shell.tsx` open paths (`replaceActivePdfBytes` L375, open effect L908) `await prior.destroy()` while the prior pdfDoc has pending lazy `getPage` tasks — `destroy()` never resolves and the new doc is never installed.

**New file `src/lib/workspace/cleanup.ts`** exporting:

```ts
type PdfLike = { destroy?: () => Promise<unknown> };

interface CleanupTargets {
  pdfDoc?: PdfLike | null;
  canvases?: Iterable<HTMLCanvasElement> | (() => Iterable<HTMLCanvasElement>);
  blobUrls?: Iterable<string>;
  workers?: Iterable<Worker>;
}

export function cleanupWorkspaceState(t: CleanupTargets): void
```

Behavior (synchronous return; all teardown fire-and-forget so the caller never blocks):

a) **pdf.js destroy** — `void t.pdfDoc?.destroy?.().catch(() => {})`. Never awaited.
b) **Canvas wipe** — for each canvas: set `width = 0; height = 0` (forces context backing-store release in Chromium/Safari), then `ctx?.clearRect`. Iterates the live `NodeList` lazily so callers can pass `() => container.querySelectorAll('canvas')`.
c) **Blob URL revoke** — for each url: `try { URL.revokeObjectURL(url) } catch {}`. A module-level `trackBlobUrl(url)` / `releaseBlobUrl(url)` registry is added so file-open paths can register the active document's object URL and the cleanup helper revokes the prior one before assigning a new one.
d) **Worker terminate** — for each: `try { w.terminate() } catch {}`. Long-lived registry includes the NER worker (`src/lib/pdf/ner.ts`) and automation worker (`src/lib/automation/runner.ts`) — both already cache a singleton; expose `resetNerWorker()` and `resetAutomationWorker()` and call them only when memory-pressure fires (not on every swap — that would re-pay startup cost).

**Wire-in `src/components/workspace/workspace-shell.tsx`:**

- Add `pageContainerRef` so cleanup can find rendered canvases for the active tab.
- `replaceActivePdfBytes` (L375–386): replace `await prior.destroy()` with `cleanupWorkspaceState({ pdfDoc: prior, canvases: () => pageContainerRef.current?.querySelectorAll('canvas') ?? [] })`, then install the new doc and bump version.
- Open-file effect (L908–947): same call before `pdfDocsRef.current.set(tabId, doc)` and before `dispatchEditorFor(LOAD)`. The new doc parses while old teardown runs in the background.
- Tab close (L658–662): already fire-and-forget — switch to `cleanupWorkspaceState` for symmetry and to also wipe canvases for that tab.
- On `counselpdf:memory-pressure`: in addition to the banner, run `resetNerWorker()` + `resetAutomationWorker()` once so the next op starts cold instead of inheriting a wedged worker.

**Blob URL registry** — refactor the four call sites that hold a document-scoped URL (`compress.tsx` L116/L194, `ocr.tsx` L137/L225, `routes/editor.tsx`, and the `workspace-shell` Save path) to use `trackBlobUrl` / `releaseBlobUrl`. Download-and-immediate-revoke sites (`merge`, `split`, `trust/export`, etc.) keep their existing inline `revokeObjectURL` — they are already correct.

## Verification

- **IE block**: DevTools UA spoof `Trident/7.0; rv:11.0` and `Edge/18` → overlay renders, no console errors in other browsers. Modern Edge (`Edg/120`) → not blocked.
- **Cleanup**: Open 70MB/400-page PDF A → scroll → open PDF B from dropzone → B renders within normal parse time, no refresh needed. Repeat 5× alternating files. Performance panel: only one pdf.js worker active after settle; old canvases drop from heap snapshot.
- **Memory pressure**: in DevTools, throw `new DOMException('quota', 'QuotaExceededError')` from console → amber banner appears, Refresh button reloads.
- **No regressions**: existing `void doc.destroy()` tab-close path keeps working; download flows that use `setTimeout(revoke, 1000)` are untouched.

## Files

- Edit: `src/routes/__root.tsx` (inline IE block + boot runtime-pressure listener)
- Edit: `src/components/workspace/workspace-shell.tsx` (use `cleanupWorkspaceState`, mount banner)
- New: `src/lib/workspace/cleanup.ts`
- New: `src/lib/runtime-pressure.ts`
- New: `src/components/workspace/memory-pressure-banner.tsx`
- Touch: `src/lib/pdf/ner.ts`, `src/lib/automation/runner.ts` (export `reset*Worker` helpers)
- Touch: blob-url owners listed above to register/release through the helper

## Out of scope

- No build-target downgrade, no polyfills, no separate legacy bundle.
- No changes to canvas rendering logic — only teardown.
- The unrelated workflow builder / storage audit work.
