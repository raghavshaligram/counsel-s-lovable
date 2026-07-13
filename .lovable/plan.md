## Root cause

In `src/components/workspace/tool-panels.tsx`, the AI PII findings list is filtered by `showPageCat` / `showSideVector`, which are derived from `activeChipKeys` (lines 2271–2286). `activeChipKeys` treats a category as an "active filter" whenever **all of its findings are currently selected**.

After a scan, every high-confidence finding is auto-selected, so every category ends up in `activeChipKeys`. The moment you uncheck a single item — say one Phone occurrence — the Phone category drops out of `activeChipKeys` while every other category stays in. Because `activeChipKeys.size > 0` and Phone is no longer in it, `showPageCat("Phone")` returns `false` and the entire Phone list is hidden. From the user's side this looks like: "I unchecked one item and the whole list vanished."

This filter was designed for explicit chip clicks (click "SSN" chip to narrow the list to SSN), but its derivation from selection state makes normal item-level toggling collapse the list.

## Fix

Decouple "which chip is a visual filter" from "which chip is fully selected".

1. In the AI Detect PII panel component, add explicit filter state:
   - `const [chipFilter, setChipFilter] = useState<Set<string>>(new Set())`.
2. Update `onChip(key)` (around line 2466) to also toggle `chipFilter`:
   - Clicking a chip adds/removes that key from `chipFilter`.
   - Clicking "all" clears `chipFilter`.
3. Keep the existing `activeChipKeys` (fully-selected derivation) ONLY for the chip's active/highlight styling, so chips still light up when a category is fully staged.
4. Change `showPageCat` and `showSideVector` to read from `chipFilter` instead of `activeChipKeys`:
   - `showPageCat(cat) => chipFilter.size === 0 || chipFilter.has(cat)`.
5. Reset `chipFilter` to empty when:
   - `docId` / `scanRecord` resets (same effect that resets `selected`, ~line 1423).
   - The "redact:clear-selection" event handler fires (~line 2097).
6. No changes to individual checkbox handlers, category checkboxes, or the commit/stage effect.

## Verification

- Run an AI PII scan on any test PDF with 2+ categories.
- Uncheck one item in a fully-staged category → the item unchecks; the rest of that category and all other categories stay visible.
- Click a category chip → the list narrows to that chip only, matching previous intent.
- Click the chip again → filter clears, all categories visible.
- Reload / new scan → filter and selection both reset.

## Scope

Frontend only, single component in `src/components/workspace/tool-panels.tsx`. No changes to redaction logic, worker code, export pipeline, or the earlier 762 MB rasterize work.