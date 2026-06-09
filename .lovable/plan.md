## Why these changes

You're right on both counts:

1. **Find** and **Detect** both redact the moment the action finishes. For a destructive action on a legal doc, that's the wrong default — the user should see *what* and *how many* will be covered before committing.
2. **Label** is the third tab, but conceptually it's the *first* decision: every Detect / Find redaction picks up `defaultLabel` at creation time. If you set the label after running them, the boxes you just made already have no label. The tab order misleads.

## Plan

### 1. Reorder right-panel tabs → `Label · Detect · Find`

- In `src/routes/redact.tsx`, swap the order of the tab buttons (line 622–642) so Label is first, then Detect, then Find.
- Default `activeTab` becomes `"label"`.
- Rewrite the Label tab copy so it reads as a setup step ("Pick an exemption code first — it'll be stamped on every redaction you add below").
- Add a small inline hint at the top of Detect and Find tabs showing the current default label (e.g. `Labeling as: (b)(6)` with a quick-edit link back to Label), so the user always knows what's about to be stamped.

### 2. Two-step Find: preview matches → confirm redact

- Replace the single `Redact all matches` submit with **`Find matches`** (non-destructive).
- On submit, call `findKeywordInPdf` and store results in a new `pendingMatches` state (don't push to `keywordBoxes` yet).
- Render a confirmation card below the form:
  - `12 matches across 4 pages for "Acme Corp"`
  - Per-page breakdown (`Page 2 · 3`, `Page 7 · 5`, …) so the user can sanity-check.
  - `Will be labeled as: <defaultLabel or "No label">`.
  - Buttons: **`Redact all 12`** (primary, vault color) and **`Cancel`** (ghost).
- Only on confirm do we promote `pendingMatches` into `keywordBoxes` / `keywordGroups` and toast success.
- Zero matches → keep existing `toast.info("No matches…")`, skip confirm card.
- Edge case: changing query / match-case / whole-word with a pending preview clears `pendingMatches` so stale boxes can't be committed.

### 3. Two-step Detect: preview detections → confirm redact

Apply the same review-before-commit pattern to auto-detect. Today the scan finishes and immediately drops boxes onto pages.

- Keep the existing first-click amber estimate card (that's a *time* warning, not a redaction confirm — different purpose).
- After the scan completes, do **not** add detections to `detections` state yet. Stage them in a new `pendingDetections` state.
- Replace the per-category enable/disable list with a **preview summary**:
  - `Found 37 items — review before redacting`
  - Same category toggle rows (SSN ×4, Email ×12, …) but they now act as *include / exclude* filters on the pending set, not as live redaction toggles.
  - `Will be labeled as: <defaultLabel>` line.
  - Buttons: **`Redact selected (N)`** (primary, counts only enabled categories) and **`Discard`** (ghost, throws away the pending scan).
- On confirm, commit the filtered detections into the existing `detections` / `detectionLabels` state so the rest of the pipeline (canvas overlays, export, certificate) is unchanged.
- After commit, the panel returns to its current "live" mode where category toggles add/remove already-committed boxes — preserving the ability to refine after the fact.
- Re-scan: if a pending set exists, second click on Scan replaces it; if a committed set exists, behavior matches today (re-scan replaces committed detections).

### What I'm *not* changing

- Manual draw-on-canvas redactions stay one-click — the user is literally drawing the box, intent is explicit.
- Box geometry, export pipeline, and certificate generation are untouched.
- OCR fallback, progress reporting, and worker pool are untouched.

### Files touched

- `src/routes/redact.tsx` — tab order, default tab, Label copy, label hints on Detect/Find, pending-matches state + confirm card in Find, pending-detections state + review-before-commit in Detect.

No other files, no schema, no new deps.
