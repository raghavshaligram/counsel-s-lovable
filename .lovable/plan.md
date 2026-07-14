# Auto-Bookmark (Heuristic, No AI)

Detect a PDF's structure from its text layer, propose an outline, let the user review, and write it back as native PDF bookmarks. 100% on-device, deterministic, no network. Falls back to silently running OCR when the doc is a pure scan.

## User flow

1. Open a PDF in the workspace → left rail → **Outline** panel (existing) gets a new **Auto-detect** button.
2. If the doc has a text layer → detection runs immediately (typically <1s per 100 pages).
3. If not → toast "Running OCR to detect headings…" → existing `ocr-pdf.ts` pipeline runs into the sidecar `ocrLayer` → detection re-runs on the OCR text.
4. Panel shows a tree preview: title, page, indent by level, checkbox per node, "collapse/expand all".
5. User can edit titles inline, drag to re-nest, uncheck to drop.
6. **Apply** writes the outline into the sidecar (annotation-store extension). Export bakes it into the PDF via pdf-lib.

## Detection engine

New module `src/lib/outline/auto-detect.ts` (pure TS, worker-safe).

Signals per text run (from `pdf.js getTextContent` — already used in `remove-bates.ts`):

- **Font size** — cluster all run sizes; runs ≥ 1.15× median body size are heading candidates. Cluster candidates into up to 4 size tiers → H1…H4.
- **Font weight / name** — bold in the PDF font name (`Bold`, `Black`, `Semibold`) promotes a run one tier.
- **Position** — runs that start a line and sit in the top 60% of the page score higher; runs indented far right are demoted.
- **Length** — 3–120 chars, no trailing period (except numbered), not ending in `,` or `;`.
- **Numbering patterns** — regex ladder assigns level directly and overrides font-size tier:
  - `^\d+\.\s` → L1, `^\d+\.\d+\s` → L2, `^\d+\.\d+\.\d+\s` → L3
  - `^[IVXLC]+\.\s` (roman) → L1
  - `^(ARTICLE|SECTION|CHAPTER|PART|APPENDIX|EXHIBIT|SCHEDULE)\s+[\dIVXLC]+` → L1
  - `^(Section|Article|Chapter)\s+[\dIVXLC]+\.\d+` → L2
  - `^[A-Z]\.\s` at line start after an L1 → L2
- **All-caps short lines** (≤ 80 chars, ≥ 60% letters uppercase, not mid-paragraph) → promote one tier.
- **De-dupe** — running header/footer detector: any candidate that appears at nearly identical (x, y) on ≥ 60% of pages is discarded (same primitive as the watermark scanner in `remove-watermark.ts`).
- **Cap** — if > 500 headings survive on a < 200-page doc, tighten thresholds and re-run once. Prevents flooding.

Output: `OutlineNode[]` with `{ title, pageIndex, level, y }`, already nested by level.

## Scan fallback (silent OCR)

- Detect "no text layer" via `getTextContent` returning empty on the first 3 pages.
- Call existing `runOcr` (already wired for the OCR tool) with progress reported into the panel: "Preparing scan… page N of M".
- Store OCR result in the sidecar `ocrLayer` — same three-layer contract as everywhere else, srcBytes untouched.
- Re-run detection on OCR text runs (they carry bbox + font size proxies from Tesseract).
- OCR text often lacks reliable font-size differences → detector falls back to numbering-pattern + all-caps + position signals only when < 3 distinct size tiers are found.

## Writing bookmarks

- Sidecar gets a new `outline` slice in `src/lib/annotate/store.ts` (or a new small store `outline-store.ts` to stay isolated). Shape mirrors detector output.
- Export path: extend `src/lib/editor/export.ts` (or the existing `outline/write.ts` if it already handles pdf-lib registration — reuse it) so `exportEditedPdf` walks the outline tree and calls `pdf-lib`'s catalog `/Outlines` writer with `Fit` destinations `[page, /XYZ, 0, pageHeight, null]`.
- Preserves existing bookmarks by default; "Replace existing" toggle in the panel.

## UI

- `src/components/workspace/outline-panel.tsx` (new) — mounted from `tool-panels.tsx` under case `"outline"`. If an outline panel doesn't already exist in the rail, add it under **Layout** in `workspace-shell.tsx` (icon `ListTree`, label "Outline & bookmarks").
- Sections:
  1. **Auto-detect** button + last-run stats ("42 headings across 3 levels").
  2. Tree view (uses shadcn `Collapsible` + drag-handle from existing patterns) with inline rename, level nudge (◄ ►), checkbox.
  3. **Apply to document** (writes to sidecar) and **Export PDF with bookmarks** (calls export pipeline).
- Empty state: "No outline yet — click Auto-detect."

## Technical notes

- Pure TS + pdf.js + pdf-lib; no new npm deps.
- Runs in the main thread for now; wrap in a worker later if needed (200-page doc measured target < 800ms after text extraction).
- Follows the three-layer contract: srcBytes read-only, outline stored in sidecar, only baked in at export.
- Persists in IndexedDB alongside annotations under the same `name::size` key.

## Files touched

- **New** `src/lib/outline/auto-detect.ts` — heuristic engine.
- **New** `src/lib/outline/outline-store.ts` (or extend `annotate/store.ts`) — sidecar slice.
- **New** `src/components/workspace/outline-panel.tsx`.
- **Edit** `src/lib/outline/write.ts` — accept `OutlineNode[]` from the sidecar.
- **Edit** `src/lib/editor/export.ts` — call the outline writer when the sidecar has entries.
- **Edit** `src/components/workspace/tool-panels.tsx` — register `case "outline"`.
- **Edit** `src/components/workspace/workspace-shell.tsx` — rail entry (only if not already present).

## Out of scope

- AI-based renaming / hierarchy inference (deferred; can slot in later as an "Enhance" button).
- Cross-document outline merging (already handled by exhibit-binder).
- Rendered TOC page (separate block in the pivot plan).
