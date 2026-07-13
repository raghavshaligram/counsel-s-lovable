# Redact inspector — findings redesign

Scope is deliberately narrow: **restructure how findings are displayed and selected after a scan runs**. Everything else stays exactly as it is today.

---

## Preserve (unchanged)

- Redact heading and the honest info banner at the top.
- **Quick scan / Full scan** buttons with device-aware time estimates as the scan entry point.
- Keyword / pattern search inputs.
- Manual box-drawing input.
- Redaction mode toggle (Maximum / Standard).
- Review-confirmation checkbox.
- On-device trust line.
- Amber "Suggestions only — never reported as complete" banner.
- All burn/verify/gate internals: `exportEditedPdf`, `verifyRedactionRemoval`, `verifySideChannelInWorker`, `SET_SRC_BYTES`, side-channel worker path.
- PDF viewer, open-tab lifecycle, editor-canvas, samplePageBg.
- Batched `ADD_ANNOS` action for all multi-select staging (no per-item dispatch).

---

## New — findings display after a scan

### 1. Scan-summary card (top of findings)

One at-a-glance line summarising what the scan found:

> Reviewed **N pages**. Found: **X** SSNs · **X** credit cards · **X** emails · **X** phone numbers · **X** IBANs · **X** dates · **X** names & organizations (Y distinct) · **X** form fields · **X** comments/annotations · metadata.

Categories with zero hits are hidden from the line. Numbers are `.toLocaleString()`.

### 2. Category groups with master checkboxes

Replace the current flat list with collapsible category sections. Each header row has:

- Master checkbox (checked / indeterminate / unchecked) — toggling stages/unstages every item in the category via one batched `ADD_ANNOS` / `DELETE_ANNOS` dispatch.
- Category label + total count.
- "(Y distinct)" suffix for categories where identical text collapses (names, emails, phones).
- Expand/collapse chevron.

Category order (highest-risk first, matches the summary line):

1. SSNs
2. Credit cards
3. IBANs / bank accounts
4. Emails
5. Phone numbers
6. Dates
7. Names & organizations
8. Form fields
9. Comments / annotations
10. Metadata

### 3. Within each category — distinct values

Expanding shows the distinct-value groups (already computed by `grouped`), each with:

- Checkbox (checked / indeterminate / unchecked) reflecting selection across its occurrences.
- The matched text.
- Occurrence count.
- Sample occurrences: first 10 rows with page + jump link, then "and N more — jump to next".

### 4. Low-confidence subsection

Any finding with confidence below the auto-select threshold goes into a separate **"Review to include (N)"** sub-section at the bottom of its category, **unchecked by default**, labelled "review to include." Ticking the sub-section header stages all low-confidence items in that category.

### 5. Live staged count + one commit button

- Persistent footer bar shows **"N items staged for redaction"** — updates on every check/uncheck (no debounce needed; count comes from `selected.size + sideSelected`).
- **One** primary button: **"Redact & verify (N items)"**. Disabled when N = 0.
- Remove the current dual "Redact selected" vs "Redact, export & verify" buttons and the separate "Wipe hidden items" button — checking a hidden-vector item stages it live like every other category, and the single commit button drives the existing hybrid burn path (page items → burn; side-channel items → sanitize worker + `SET_SRC_BYTES` + verify).

---

## Staging behaviour (unchanged semantics, batched dispatch)

- Checking a page-vector item stages `redact-det-<id>` immediately (already implemented, keep as-is).
- Checking a side-channel item marks it staged in the selection set only — the actual cleaning still happens in the commit path (`sanitizeInWorker` → `verifySideChannelInWorker` → `SET_SRC_BYTES`) so we never partially wipe form fields mid-review.
- All bulk toggles (category master, low-conf master, top-level select-all) route through `startTransition` and dispatch **one** `ADD_ANNOS` / `DELETE_ANNOS` per toggle — never a loop of single dispatches. This is the fix that keeps 13k-item selects instant on 5000-page docs.

---

## Files touched

- `src/components/workspace/tool-panels.tsx` — `AutoDetectSection` (lines ~1280–2500 and its render block ~2016+). New sub-components stay in-file to avoid a cross-file refactor.
  - Add `SummaryCard` (renders the category-totals line).
  - Replace the current `<ul>` findings tree with `CategoryGroup` components (header + distinct-value list + low-conf subsection).
  - Replace the footer button row with `StagedFooter` (live count + single commit button).
  - Keep `redactSelected` as the single commit handler — no new burn code.

No changes to:
- `src/lib/editor/state.ts` (`ADD_ANNOS` / `DELETE_ANNOS` / `SET_SRC_BYTES` already exist).
- `src/lib/workers/verify.worker.ts`, `verify-client.ts`.
- `src/lib/pdf/detect-pii.ts` (categories are already emitted).
- `RedactPanel` shell (heading, banner, scan buttons, mode toggle, review-confirm, trust line, pattern search, manual box tool).

---

## Acceptance test (from the brief)

1. Scan a large doc → summary card lists category totals.
2. Tick "Form fields (12)" only → footer shows "12 items staged", nothing else selected.
3. Tick "SSNs (1,222)" also → footer shows "1,234 items staged".
4. Expand "Names" → deselect one distinct name (3 occurrences) → footer count drops by 3.
5. Click "Redact & verify (1,231 items)" → single commit runs page burn + side-channel wipe + verify → verified output.
6. On a 13k-finding scan, master-checkbox toggles feel instant (batched dispatch, `startTransition`).

Say **go** and I'll ship it.