# Redact — End-to-End Design Audit (no code changes)

Scope: exactly how the Redact feature works today, every file involved, in
order, followed by an honest assessment of what is essential vs. legacy /
patch-artifact / over-complex. Nothing here proposes edits — this is the
picture to review before we simplify.

---

## 1. Entry points (every way redaction can start)

There are **four** entry points into the redact pipeline. All of them
ultimately funnel through the same detect-pii scanner and the same
rasterize → sanitize → verify → gate export path.

### 1.1 Manual — the Redact tool in the workspace
- `src/components/workspace/tool-panels.tsx` → `RedactPanel` (~L1934)
  - Free: user draws boxes on the canvas (`editor-canvas.tsx`,
    `state.tool === "redact"`).
  - Pro sub-sections inside the same panel: `ProRedactSection`
    → `AutoDetectSensitive` (AI scan) and `PatternRedact` (keyword/regex).
  - Final "Redact, export & verify" button lives in `RedactPanel`.
- Left-rail navigation: `workspace-shell.tsx` sets `activeToolId === "redact"`
  and flips `editor.tool` to `"redact"` so the canvas enters draw mode.

### 1.2 AI Auto-detect — Pro
- `AutoDetectSensitive` in `tool-panels.tsx` (~L1091).
- Kicks off `detectPiiInPdfViaWorker` + `detectPiiInSideChannelsViaWorker`
  via `src/lib/workers/detect-pii-client.ts` (spawns `detect-pii.worker.ts`).
- Wrapped in `runAsJob({ kind: "detect-pii", docId })` from
  `src/lib/jobs/registry.ts` (background job, survives tab switch).
- Findings are persisted in `src/lib/jobs/pii-scan-results.ts` (Zustand
  store keyed by docId).

### 1.3 Pattern / keyword redact — Pro
- `PatternRedact` in `tool-panels.tsx` (~L833).
- Uses `findKeywordInPdf` from `src/lib/pdf/detect-pii.ts`.
- Not a background job (runs on main thread with per-page yields).
- Only stages redact annotations — user still confirms via the
  `RedactPanel` export button.

### 1.4 Agent / Assistant flow
- `src/lib/agent/flows.ts` classifies "redact all SSNs" / "black out names".
- `src/components/workspace/agent-panel.tsx` → `runDetectRedact` (~L331).
- Same worker + `runAsJob` path as the manual AI scan.
- On completion, dispatches `agent:redact-seed` custom event; the
  `AutoDetectSensitive` panel listens for it and hydrates the findings
  list without re-scanning.

### 1.5 Workflow builder step
- `workflow-builder-panel.tsx` (~L199) exposes ops `redact-pattern`,
  `redact-manual` (marked unavailable — needs canvas), `redact-ai`
  (marked unavailable — needs review UI).
- Only `redact-pattern` actually runs, via
  `src/lib/automation/main-registry.ts::makeRedactPattern` (~L84).
- That op wraps `rasterizeRedactedPages + enforceRedactionGate` in a
  `runAsJob({ kind: "redact-export" })` and produces bytes for the next
  workflow step — bypasses the manual `RedactPanel` UI entirely.

### 1.6 Export dialog (indirect entry)
- `src/components/workspace/export-dialog.tsx` (~L119) — if the currently
  loaded doc already has redact annotations, the generic Export flow ALSO
  runs `rasterizeRedactedPages + enforceRedactionGate` on the way out.
- Same gate module, different UI wrapper. This creates two nearly-identical
  export code paths (Export dialog vs. RedactPanel "Redact, export &
  verify") — see §5 for the duplication.

### 1.7 Legacy standalone `/redact` route
- `src/routes/redact.tsx` → `src/components/redact-page.tsx` — separate
  page (not the workspace) that still exists for SEO/marketing landing and
  uses `detect-pii-client` directly. Not the primary path.

---

## 2. Detection flow (Scan → findings appear)

Trigger: user clicks **"Scan for sensitive info"** in the Redact panel.

### 2.1 UI kicks off a job
File: `tool-panels.tsx::AutoDetectSensitive.runScan` (~L1171).
Steps:
1. `beginScan(docId)` in `pii-scan-results.ts` — creates a queued record
   in the Zustand store so the jobs indicator and other tabs can see it.
2. `runAsJob({ kind: "detect-pii", docId })` in `jobs/registry.ts` —
   registers the job, hands back `{ jobId, promise, signal }`; tab-close
   cancels via signal.
3. Dynamic-imports the worker client and calls
   `detectPiiInPdfViaWorker(file, 1.5, onProgress, signal, onPartial)`.
4. Follows with `detectPiiInSideChannelsViaWorker(file, signal)`.

### 2.2 Worker client (main thread → worker)
File: `src/lib/workers/detect-pii-client.ts`.
- Reads `file.arrayBuffer()` and posts it (transferred) to a fresh
  `detect-pii.worker.ts` instance.
- **RAF-batches** progress + partial callbacks to protect the main thread
  from hundreds of postMessages/sec during a large scan (this exists
  specifically because streaming findings live was starving the "open a
  new PDF" path).
- One worker instance PER scan; terminated on completion, error, or abort.

### 2.3 Worker (`detect-pii.worker.ts`)
- Imports the same `detectPiiInPdf` used on main thread.
- Uses `OffscreenCanvas` for pdf.js render + Tesseract OCR so nothing
  needs `document`.
- Forwards progress / partials / result via `postMessage`.

### 2.4 `detectPiiInPdf` — the actual pipeline
File: `src/lib/pdf/detect-pii.ts`.
Order of passes, all on the same `pdfjs.getDocument` handle:

**Pass A — regex + heuristics + privilege terms (all pages, per-item)**
- For each page: `page.getTextContent()` → walk `items`.
- If total chars on page < 20 → push page onto `ocrPages` list, skip.
- Per item, run:
  - `matchAllCategories(str)` — structured PATTERNS (SSN, email, phone,
    creditCard, date, ipAddress, iban) + strong-signal person names
    (title/suffix/O'/Mc heuristics) + "X v. Y" case caption both parties.
  - `PRIVILEGE_TERMS_RE` — flags privilege/confidentiality context words
    and any values nearby (e.g., dollar amount next to "settlement").
- Emits `Detection` per hit via `emitBoxFor`.
- Also stashes each NER-eligible item (≥8 chars, has letters) into
  `pageNerWork[i].items` — no inference yet.
- Streams findings to the UI as `onPartial` per page, `pass:"regex"`.

**Purpose of Pass A:** cheap, deterministic, high-precision. Finishes in
seconds on a 500-page doc, so the panel populates immediately while the
slow NER work runs.

**Pass B — batched NER, per-item (cache-friendly)**
- Flattens `allNerItems` across all pages.
- Batch size: 32 items on ≤4 cores, 48 on more.
- Calls `runNerBatch(texts, "detect-pii:item-batch")` from
  `src/lib/pdf/ner.ts`.
- `ner.ts` internals:
  - Loads Xenova/bert-base-NER via Transformers.js.
  - Tries `device: "webgpu"` first, falls back to WASM q8.
  - Per-input FNV-1a 64 hash → LRU cache (1024) of `hash → NerEntity[]`.
    Cache hits skip inference — big win on repeating headers/footers/
    captions across large docs.
- Drops entities that overlap already-emitted regex "name" spans (no
  double boxes).
- Emits detections; streams `pass:"ner"` partials grouped by page.
- Yields `setTimeout(0)` between batches so the browser can render other
  tabs / open a new PDF.

**Purpose of Pass B:** catches proper-noun names / organizations that
regex heuristics don't (unmarked names in prose). It's the slow, high-recall
pass — that's why streaming Pass A first matters.

**Pass C — OCR for image-only pages (only if `ocrPages.length > 0`)**
- Tesseract worker pool: 1 worker on ≤4 cores, else `min(3, floor((hw-2)/2))`.
- Bounded-concurrency queue: peak canvas count = poolSize (not doc size)
  — this is the 3000-page OOM fix.
- Per page:
  1. Render at `ocrScale = max(1.5, 3)`.
  2. `worker.recognize(canvas, ..., { blocks: true })`.
  3. Free canvas immediately, then cluster words into lines.
  4. Per line: run regex + digit-normalized regex + privilege terms.
  5. Single NER call per PAGE on the joined lines (not per-line — big
     speedup).
  6. Emit spans back at `scale = 1.5`.
  7. If page "looksStructured" but yielded <2 hits → mark
     `ocrUnderDetectedPages` (surfaces a warning in the panel).
  8. Confidence < 60 → `lowConfidenceOcrPages` (panel shows "manual
     review required" warning).

**Purpose of Pass C:** scanned pages have zero text-layer items, so
Pass A/B see nothing. This is the only way to catch PII on scans.

**Side-channel scan — `detectPiiInSideChannels` (parallel-ish, own worker call)**
- Not part of the page passes above. Runs after via
  `detectPiiInSideChannelsViaWorker`.
- Walks pdf-lib AST for:
  - AcroForm field `/V` values (also orphan field dicts).
  - Every page's annotations: `/Contents`, `/RC`, `/T`, `/Subj`.
  - Info dict: Title, Author, Subject, Keywords, Producer, Creator.
  - XMP metadata stream (regex-extracted literals from common namespaces).
- Emits `SideChannelFinding` with `vector: "form-field" | "annotation" |
  "metadata"` and no page rect (they are removed by sanitize, not by
  drawing a box).

**Purpose of side-channel:** page redaction can't see these. Without this
scan, the exported file can still leak SSN via a form field the user
never saw.

### 2.5 Progress and streaming into the UI
- Worker → client (RAF-coalesced) → `appendScanFindings(docId, dets)` in
  `pii-scan-results.ts` → `AutoDetectSensitive` re-renders.
- Auto-select: on completion, findings with `confidence !== "low"` are
  ticked by default; low-confidence names are left unchecked.

---

## 3. Review flow (findings UI)

File: `tool-panels.tsx::AutoDetectSensitive` (~L1538 onward).

- Yellow "Suggestions only" banner — never claims completeness.
- Findings split into three sections:
  1. **Page-redactable findings** (`vector === "page"` or absent).
     Grouped `category → snippet-text`. Each snippet-group is ONE row
     with an occurrence count + tri-state checkbox (all / some / none of
     the underlying detections). "Pages" expander shows every occurrence
     for jump-to-page.
     Categories ordered by total detection count.
  2. **Hidden in document** (`vector ∈ {form-field, annotation, metadata}`).
     Grouped by vector. Each finding individually selectable.
  3. **Context flags** (`privilegeContext`) — informational, non-selectable,
     just jump-to-page.
- "Redact selected" button routes each selected item to one of two paths:
  - Page findings → `editorDispatch({ type: "ADD_ANNO", kind: "redact" })`
    at the finding's `pdfRect`. Skips duplicates by rounded-rect key.
    Nothing burns yet — the user still has to click "Redact, export &
    verify" in the panel below.
  - Side-channel findings → **apply-now**: sanitize the live bytes,
    re-`verifyRedactionRemoval` against the sensitive text, `LOAD` the
    new bytes into the editor, and drop them from the visible list.
    Failure throws a hard error surfaced as a toast.

**One notable UX asymmetry:** page findings are a two-step (stage boxes →
export), but side-channel findings apply immediately. This confuses "did
it work?" — see §5.

---

## 4. Redaction application (boxes → verified output)

Trigger: user clicks **"Redact, export & verify"** in `RedactPanel`
(~L1971).

Two-phase commit:

### Phase 0 — Confirm dialog
- `confirmDialog({ title: "Apply redactions?" ... })` — dangerous action
  gate. Cancel returns.

### Phase 1 — Rebuild the PDF from the editor sidecar
- `exportEditedPdf(exportDoc)` in `src/lib/editor/export.ts`.
- pdf-lib copies pages, applies rotations, draws every non-redact
  annotation, embeds OCR sidecar as invisible text.
- For redact annotations, populates a `PageRewrite` and calls
  `rewriteDocument(out, rewrites)` from `text-rewrite.ts`.
- `text-rewrite.ts` does **destructive content-stream surgery**:
  tokenizes each page stream, estimates each Tj/TJ operator's bounding
  box, drops operators whose box falls inside a redact rect; also drops
  image `Do` ops fully inside; string-fallback removal via
  `redactStrings`.
- Result: bytes where the underlying glyphs are gone at the stream level
  (but the visible page hasn't been re-rasterized).

### Phase 2 — Rasterize redacted pages
File: `src/lib/editor/rasterize-redacted-pages.ts`.
- For every page carrying a redact rect, re-render via pdf.js at
  scale=2.5, paint solid-black rects on the bitmap, embed as JPEG,
  replace page in the pdf-lib doc.
- Peak memory = 1 canvas + 1 JPEG (streaming). Sort keys descending so
  removePage/insertPage doesn't disturb later indices.
- Mode: `"always"` (default, "Max security") = rasterize every redacted
  page; `"fallback"` = only rasterize pages where pdf.js text items STILL
  intersect a redact rect after Phase 1's stream surgery.
- Returns `{ bytes, rasterizedPages }`.

### Phase 3 — Sanitize side-channels
File: `src/lib/pdf/sanitize.ts`.
- Clears Info dict + XMP.
- Empties AcroForm field values, then deletes the whole `/AcroForm` dict.
- Removes all text-carrying annotations (Text, FreeText, Highlight,
  Underline, Squiggly, StrikeOut, Caret, Stamp, Ink, FileAttachment,
  Sound, Movie, RichMedia).
- Strips OCGs and OCG-gated content, embedded files, and JS triggers
  (`/Names /JavaScript`, `/OpenAction`, catalog + page-level `/AA`).

### Phase 4 — Verify removal (side-channel + raw stream + page geometry)
File: `src/lib/editor/verify-redaction.ts::verifyRedactionRemoval`.
- `verifyPageGeometry` — re-parse with pdf.js, check no text sits inside
  the redact rects.
- `verifySideChannelVectors` — scan the AST for sensitive strings inside
  form/annotation/attachment/OCG data.
- `verifyRawStreams` — decode every flate stream and search for the
  sensitive text and its hex/UTF-16BE encodings; skips pages in
  `rasterizedPages` set (they have no residual glyphs).

### Phase 4b — Local safety net (RedactPanel only, ~L2069-2097)
If verify fails on `vector === "page"` leaks, re-collect leaking pages
into a map and call `rasterizeRedactedPages` again in `"always"` mode,
then re-verify. If side-channel leaks remain, throw and abort download.

### Phase 5 — `enforceRedactionGate` (the "single chokepoint")
File: `src/lib/editor/redaction-gate.ts`.
- Runs its OWN sanitize pass (unless `alreadySanitized` — but
  RedactPanel does NOT pass this flag, so sanitize runs twice in that path).
- Runs its OWN `verifyRedactionRemoval`.
- If page leaks remain, runs its OWN raster-fallback pass on leaking pages.
- Throws `RedactionGateError` on any leak. Guaranteed by
  `tests/redaction-gate.test.ts`.

**Important:** In the manual `RedactPanel` path, the gate is NOT called
— steps 3+4+4b duplicate what the gate would do. In the Export-dialog
and Workflow paths, only the gate runs (no local safety net; the gate
handles raster-fallback internally).

### Phase 6 — Pixel-verify (RedactPanel only, ~L2100)
File: `src/lib/editor/verify-pixel-redaction.ts`.
- For each rasterized page: re-render, crop each redact rect, run
  Tesseract OCR on the crop. Any word ≥3 chars with confidence ≥50 →
  hard error, block download.
- Not part of `enforceRedactionGate`. Not run in the Export-dialog or
  Workflow paths.

### Phase 7 — Download + certificate
- `downloadPdf(bytes, "...-redacted.pdf")` in `src/lib/pdf/download.ts`.
- Dispatches `agent:redact-complete` (used by agent-panel).
- Opens a **Certificate of Redaction** gate
  (`requestCertificate` → `buildRedactionCertificate` in
  `src/lib/pdf/redaction-certificate.ts`) — auth-walled free-signup
  ask; SHA-256 of source and redacted bytes, per-category/per-page
  counts, verification summary.

---

## 5. Assessment — what each step actually adds

### Essential (keep, no question)
| Step | Why it's essential |
|---|---|
| Detect-pii Pass A (regex + privilege) | Deterministic, sub-second UX; catches structured PII (SSN/card/email/phone/IBAN) with high precision. |
| Detect-pii Pass B (NER, per-item + cache) | Only path that finds unmarked person/org names in prose. Per-item cache is what makes it survive 5000-page docs. |
| Detect-pii Pass C (OCR) | Only path for scanned pages. |
| Side-channel scan | Only path for form/annotation/metadata PII. |
| Worker isolation (`detect-pii.worker.ts`) | Fixed the "other tabs go grey" class of bugs. |
| Jobs registry + `pii-scan-results` store | Scans survive tab switches; concurrent scans on multiple docs. |
| Content-stream rewrite (`text-rewrite.ts`) | Real glyph removal — cover-only would leak via copy/paste, font tricks, CMap. |
| Rasterize redacted pages ("always" mode) | Only way to be defensible against font/CMap/PDF-viewer tricks. |
| Sanitize side-channels | Form fields / annotations / metadata / OCGs / attachments must go. |
| Verify (page geometry + side-channel + raw stream) | The safety guarantee. |
| Confirm dialog | Destructive, irreversible; two-phase commit is correct. |

### Legacy / patch-artifact — worth reconsidering
1. **Two nearly-identical export paths** (RedactPanel L1971-2205 and
   Export-dialog L119-187). Both do rasterize → sanitize → verify but in
   subtly different orders and with different safety nets:
   - RedactPanel: `exportEditedPdf` → rasterize → sanitize → verify →
     local raster safety net → pixel-verify. (`enforceRedactionGate` NOT
     called.)
   - Export-dialog: rasterize → `enforceRedactionGate` (which itself
     sanitizes + verifies + raster-fallbacks). No pixel-verify.
   - Workflow op: same as Export-dialog.
   Result: the RedactPanel path has an extra pixel-verify layer nobody
   else runs, AND it sanitizes twice if we ever call the gate from it.
   This asymmetry is a patch artifact from three separate incidents.

2. **`enforceRedactionGate` re-sanitizes even when the caller already
   did**. `alreadySanitized: true` exists but is only used by tests.
   Cheap-but-still real duplicate work on every export path.

3. **Local raster safety net in RedactPanel (L2069-2097)** duplicates
   the gate's own raster-fallback pass. Pre-dates the gate; not needed
   once we route this path through the gate.

4. **Pixel-verify (`verify-pixel-redaction.ts`)** — added after a
   specific "burned rect wasn't opaque enough" incident. `rasterize` now
   paints RGB(0,0,0) at scale 2.5 which is provably opaque; re-OCR-ing
   every burned page adds seconds per page and only defends against a
   regression that would already fail the pixel diff or a manual
   spot-check. Value is defensive-in-depth; cost is a slow "Re-OCR check
   on burned pages…" toast the user sees on every export.

5. **Apply-now for side-channel findings** (tool-panels L1367-1449) uses
   `sanitizePdfBytesWithReport` + `verifyRedactionRemoval` inline, then
   `LOAD`s new bytes into the editor. Works, but:
   - It's a separate code path from the export-time sanitize (Phase 3).
   - The findings are removed from the visible list, so a user can't
     tell what was cleared without re-scanning.
   - This exists to fix "form-field leaks past flatten/PDF-A"; the same
     guarantee could be enforced at export time by always running
     sanitize before those steps in the export pipeline, without a
     separate in-place mutation branch.

6. **`redact-page.tsx` (`/redact` route)** — the pre-workspace standalone
   page. Still linked from marketing. Duplicates a slim version of the
   workflow. Not obviously reachable from the workspace UI.

7. **`ocrUnderDetectedPages` warning** — was added when OCR would
   silently miss whole pages; useful, but its threshold (`hits < 2 on a
   structured-looking page`) is a heuristic that fires false-positive on
   e.g. a scanned title page. Adds a scary warning that doesn't always
   mean a real problem.

8. **Certificate flow triggered from inside the export callback**
   (`requestCertificate` at L2137). Success-path only, correct, but the
   auth-wall dialog appears immediately after "Verified" — surprises
   users who thought the click just downloaded a file.

### Complexity/latency without a clear necessity
- **Double sanitize** in the RedactPanel path if we ever route through the
  gate.
- **Pixel-verify OCR pass** on every burned page — expensive on scanned
  docs, defensive.
- **Two separate worker calls** for the same file: `detect-pii` then
  `detect-pii-side`. Both re-read `file.arrayBuffer()`. Could be one
  worker call returning both, saving a full worker spin-up + a large
  bytes transfer on every scan.
- **Sanitize inside `enforceRedactionGate`** even when the export
  pipeline already sanitized (`alreadySanitized` flag not passed).

### Design-level friction points (not bugs, just the design)
1. **Two-step UX for page findings, one-step for side-channels.**
   Selecting an SSN in a form field wipes it immediately; selecting an
   SSN in page text just stages a box you must then export. The panel
   title and button labels don't warn about this. Users have reported
   "did anything happen?" — because half of what they selected did, and
   half didn't.

2. **"Redact selected" → "Redact, export & verify" language mismatch.**
   Two buttons that both say "Redact". The lower one is the destructive
   commit; the upper is a staging action. Confusing on first use.

3. **The "Suggestions only" banner is permanent + prominent.** Legally
   necessary, but it visually competes with the findings list and never
   goes away, so it becomes noise.

4. **Progress states are chatty and asymmetric.** During export the user
   sees: "Building redacted PDF…" → "Burning redaction regions…" →
   "Burning redactions 12/34…" → "Scrubbing form fields, comments,
   metadata…" → "Verifying removal…" → "Re-OCR check on burned pages…"
   → "Verified — 12/12 regions cleared · 3 pages pixel-burned &
   OCR-verified" → Certificate dialog opens. Each step is real, but the
   total experience is "why is this taking so long and what's going wrong
   now?" Every phase has its own toast id juggling.

5. **The safety guarantee is spread across four files**
   (`text-rewrite.ts`, `rasterize-redacted-pages.ts`, `sanitize.ts`,
   `verify-redaction.ts`) and the ORDER matters. `redaction-gate.ts`
   was supposed to be the single chokepoint but only the Export-dialog
   and Workflow paths honor it — the flagship "Redact, export & verify"
   button in `RedactPanel` re-implements the pipeline manually.

6. **Certificate is a value-gate for a "free signup"** but fires
   post-verification on the user's happy path — turning a successful
   redaction into an auth ask.

7. **Findings-store hydration on tab switch** (~L1114) resets local
   state from the persisted record every time. This mostly works, but
   any transient local UI state (which group is expanded, which finding
   is being hovered) is thrown away on switch. Not a bug, but the
   granularity is coarse.

---

## 6. TL;DR — where a simplification pass should focus

1. **Collapse to a single export path.** Route the manual "Redact,
   export & verify" button through `enforceRedactionGate` like the
   Export-dialog and Workflow already do. Delete the local raster
   safety net (dup of the gate) and either move pixel-verify inside the
   gate or drop it. Net: one authoritative pipeline, fewer paths to
   audit.

2. **Make selection symmetrical.** Either both page + side-channel are
   staged and applied together at export time (my recommendation), or
   both are applied immediately. Two-mode selection is the biggest
   confusion source.

3. **Fold `detectPiiInSideChannels` into the main scan** and return
   both from one worker call. Saves a worker spin-up + a second file
   transfer on every scan.

4. **Retire the standalone `/redact` route** (or make it a thin
   redirect to workspace with the redact tool active). Keeping two
   implementations alive costs every future change twice.

5. **Fewer, calmer progress states.** Coalesce the toast chain into two
   phases: "Redacting…" (rasterize + sanitize) and "Verifying…"
   (verify + gate). Show percent + step-name in one toast, not five.

6. **`alreadySanitized: true`** should be passed by any caller that
   already sanitized. Delete duplicate sanitize work.

7. **Reconsider the certificate auth-wall placement.** Move it behind an
   explicit "Get certificate" button on the success screen, not
   automatic on every successful redaction.

8. **Kill the `ocrUnderDetectedPages` warning** or replace it with a
   quieter "Review scanned pages manually" prompt without triggering an
   alarm-shaped toast.

None of the essential safety guarantees (real glyph removal, rasterize,
sanitize, verify, gate throw) are the source of friction. The friction
is duplicated paths, asymmetric UX branches, and chatty progress. The
core pipeline is sound.
