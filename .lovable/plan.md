# Inline per-category Redact + single Export in Commit

Rework the redact flow so each category redacts on the spot, and the Commit section only exports. Also fixes the 314-leak pixel-verify failure blocking the download.

---

## Part 1 — Inline "Redact" popup per category

**Today.** Tick items → one giant "Redact & verify (N items)" button at the bottom → burn + verify + **download** in one shot. Doing SSNs *and* phones means two commits and two downloads.

**New behavior.**

1. **Per-category inline action.** Every category group (SSN, Phone, Names, Form fields, Comments, Metadata, etc.) — the ones you already have tabs for — gains an inline **Redact (N)** button next to its master checkbox. It's disabled until at least one item in that category is ticked and enables the moment selection > 0.
2. **Popup confirmation** (small anchored popover, not a modal):
   - `Redact 122 SSNs from this document?`
   - single-line **"I've reviewed these matches"** checkbox (the current sign-off, scoped to this category)
   - **Cancel** · **Redact** buttons
3. **Redact action runs the existing pipeline in-place:** burn → sanitize → verify → pixel-verify → auto-escalate (see Part 3) → write cleaned bytes back via `SET_SRC_BYTES`. **No download.**
4. **On success:** category collapses to a green "✓ 122 SSNs redacted" row with an **Undo** link (only until the next redact — undo just re-loads the pre-commit bytes snapshot kept in memory). Category disappears from the tabs bar. Findings list refreshes from the new bytes so already-cleaned items don't re-appear.
5. **On failure:** popover turns red, shows page numbers of stubborn leaks, offers **Retry with max security** (forces raster mode) — nothing is written to `srcBytes`, doc is untouched.

**Multi-category workflow becomes:**
Tick SSNs → Redact → ✓ · Tick Phones → Redact → ✓ · Tick Form fields → Redact → ✓ · Export.

**The bulk "All" tab keeps a Redact button too**, for users who really do want to nuke everything at once.

---

## Part 2 — Commit section becomes Export-only

Rename `Commit` → **`Export`**. It shows:

- A summary line: `3 categories redacted · 458 items removed · Ready to export.`
- Primary button: **Export redacted PDF** — runs one final cheap verify pass on current `srcBytes`, downloads.
- Secondary link: **Redaction Certificate** (existing free-signup gate) — fires here, not on every category commit.
- If no categories have been committed yet: button is disabled with hint `Redact at least one category first.`

**No sign-off checkbox on export** — sign-off already happened at each category popover, which is the actual destructive step.

**Copy sweep** (`tool-panels.tsx` L1134, L1290, L1550, L1805, L2931, L3352 + `agent-panel.tsx` L911, L926): every "Redact, export & verify" → context-appropriate replacement (`Click Redact on any category above` in guidance; `Export redacted PDF` on the final CTA).

---

## Part 3 — Fix the 314-leak pixel-verify failure

Same fix I proposed before, unchanged — it's what makes per-category Redact reliably succeed instead of blocking the flow just like the current single button does.

**Root cause.** `verifyPixelRedaction` re-OCRs each burned rect at high DPI. Vector burn (mode `fallback`) draws opaque rects on exact target bounds. Anti-alias tails of narrow/italic serif glyphs bleed 0.5–1.5px past the rect on 3000-page form-heavy docs, so 314 rects re-OCR as fragments and download refuses.

**Three-part fix:**

1. **Inflate burn rect by +1.5pt** each side in `rasterizeRedactedPagesInWorker` (vector + raster paths). Covers bleed without merging adjacent rects.
2. **Auto-escalate on leak, don't hard-fail.** In the per-category redact action: if pixel-verify reports leaks, re-run rasterize on *only the leaked pages* with `mode: "always"` at scale 3.0, then re-verify. Only fail (and surface the red popover from Part 1 §5) if the second pass still leaks.
3. **Ignore sub-word OCR noise.** In `verify-pixel-redaction.ts`, drop leaks that are single characters, Tesseract confidence < 60, or punctuation/whitespace-only. Anti-alias fragments aren't real leaks.

**Files:** `src/lib/workers/rasterize.worker.ts` (+ client), `src/lib/editor/verify-pixel-redaction.ts`, per-category redact handler in `src/components/workspace/tool-panels.tsx`.

---

## Files touched (total)

- `src/components/workspace/tool-panels.tsx`
  - Category group render (~L2260-2540): inline Redact button + popover per category, ✓-done state, Undo.
  - Side-channel groups (~L2620-2690): same inline Redact button per vector.
  - Commit section (~L3300-3400): renamed to Export, split from redact, sign-off removed.
  - `exportRedacted` split into `redactCategoryInPlace(ids)` (used by every popover) and `exportRedactedPdf()` (used by Export button).
  - Copy sweep.
- `src/components/workspace/agent-panel.tsx` — copy strings only.
- `src/lib/workers/rasterize.worker.ts` + `rasterize-client.ts` — `padPt` option.
- `src/lib/editor/verify-pixel-redaction.ts` — confidence/length filter + page-number surfacing.
- `src/lib/editor/state.ts` — new `hasCommittedRedactions` + `preCommitSnapshot` (small ring buffer for Undo).

**No changes:** viewer, editor-canvas, sanitize.worker, verify.worker, `enforceRedactionGate`, sidecar model, tab lifecycle.

---

## Non-goals

- No auto-download after per-category redact.
- No new burn code path — every Redact button funnels into `enforceRedactionGate`.
- No multi-level undo history — Undo covers only the most recent category commit.
- No modal — popover is anchored to the category row, dismissable on outside-click.

---

## Build order

1. Split `exportRedacted` into `redactCategoryInPlace` + `exportRedactedPdf`.
2. Per-category popover + inline Redact button (page-vector categories first, then side-channel vectors).
3. Renamed Export section with single-verify export.
4. Rect-pad + confidence filter in pixel-verify.
5. Auto-escalate raster fallback for leaked pages.
6. Copy sweep + Undo snapshot.

Approve and I ship in that order.
