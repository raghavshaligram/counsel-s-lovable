## Goal

Fix three things without destabilizing the current editor canvas:
1. Text-box editing bug
2. Insert-image doing nothing
3. Adobe-style edit overlay (transparent + thin outline + subtle glow, no white rectangle)

Plus wire the new `FontResolver` into the edit-text detection path and the inspector font dropdown.

## Guardrails (what stays frozen)

- No changes to: PDF viewer/page render loop, zoom, tab lifecycle, `samplePageBg`, IntersectionObserver plumbing, `openPdf` / `pdfDoc` sharing.
- All edits to `editor-canvas.tsx` are pinpoint replacements at named line ranges — no restructuring, no reordering hooks, no touching the render effect.
- No file renames. No new deps.

## 1 — Diagnose first (read-only, before any edit)

Before writing patches I'll open the current preview, reproduce both bugs, and capture what actually fails:
- Add text box → does the overlay mount, is the click coord off, does the textarea receive focus, does commit run?
- Insert image → `tool-panels.tsx:324` dispatches `SET_PENDING_IMAGE`, `editor-canvas.tsx:593` reads it on canvas click. Likely regressions: tool never switches to `"image"`, or the pending image is cleared before the click, or the click handler is gated behind a condition that no longer passes.

The plan below assumes the two most likely root causes; I'll adjust the specific patch after repro but keep the scope identical.

## 2 — Text-box edit overlay (Adobe-style)

Target: the edit overlay only (the DOM node that wraps the textarea while an existing text run is being edited). Not the underlying render.

Changes, in the overlay's className/style only:
- Remove `bg-white` / any solid fill.
- `background: transparent`.
- `outline: 1px solid rgba(76,127,184,0.9)` (steel-blue `--vault`) with `outline-offset: 1px`.
- `box-shadow: 0 0 0 3px rgba(76,127,184,0.18)` for the soft glow.
- Textarea: transparent bg, caret color = resolved text color, no border.
- Leave the underlying rendered glyph visible (do NOT paint a cover rect while editing).

Amber variant (`--color-privacy`) is available if you prefer amber over steel-blue — noting it, not switching without your call.

## 3 — Text-box bug fix

Scope: only the text tool's pointer-down → create-annotation branch and the overlay's commit path. I will:
- Verify the click-to-PDF-point conversion still lines up (compare to the working image branch at line 593 which uses the same conversion).
- Verify `tool === "text"` actually reaches the branch (no earlier `return` swallowing it).
- Ensure the newly created text annotation is auto-selected AND flagged as `editing` so the overlay mounts in one gesture (current behavior might require an extra click).
- Ensure `Escape` and click-outside commit rather than discarding.

No changes outside the text branch and the overlay component.

## 4 — Insert-image fix

`tool-panels.tsx:324` builds a valid `pendingImage`. The canvas handler at `editor-canvas.tsx:593` only fires when `state.tool === "image" && state.pendingImage`. Fix path:
- Confirm `tool-panels.tsx` also dispatches `SET_TOOL "image"` alongside `SET_PENDING_IMAGE` (if missing, add that one dispatch — it lives in tool-panels, not the canvas).
- Confirm the file-picker's click handler isn't consuming the event or resetting the tool before the user clicks the canvas.
- If the canvas branch runs but nothing appears: verify the new image annotation gets pushed and the page invalidates. No render-loop changes — just ensure `ADD_ANNO` fires with a valid page index.

All fixes stay in `tool-panels.tsx` and the single `if (state.tool === "image" ...)` block already in the canvas.

## 5 — Wire FontResolver into edit-text

New tiny bridge file (no changes to existing font modules):

- `src/lib/fonts/bridge.ts` — exports `resolveToFontKey(query): { key: FontKey; exact: boolean; weight: number; italic: boolean }`. Internally calls `resolveFont()` then maps `CanonicalFont.id` → existing `FontKey` via a lookup table (serif/sans/mono/monospaced families → nearest embedded key). This preserves the current embed pipeline untouched.

Call-site swaps (2 lines each, mechanical):
- `editor-canvas.tsx:481-482` — replace `detectFontKey(...) + matchPdfFont(...)` with `resolveToFontKey({ postscriptName: sanitizedFontName, pdfFamily: family, cssFamily: sanitizedCssFamily })`. Keep the `det` / `matchedFont` variable names so downstream code is unchanged.
- `editor-canvas.tsx:536` — same, for the Helvetica default branch.
- `editor-canvas.tsx:1162-1164` — replace the `matchPdfFont` loop with a single `resolveToFontKey` call.

Inspector font dropdown: it reads `FONT_META` / `FONT_KEYS`. No change to the dropdown itself — the resolver just feeds it a better initial `FontKey` and weight/italic hints, so the selected value matches the source PDF's font on first render.

Old `matchPdfFont` / `detectFontKey` stay in place (still used by `detect-pii.ts` and `/editor` route). No migration beyond the three canvas call sites.

## 6 — Verify

- Playwright: open workspace, load the sample PDF already in the session, run text-add + image-insert + edit-existing-text, screenshot the overlay for the transparent+outline look, confirm no console errors.
- Unit: extend `tests/fonts/resolver.test.ts` with one bridge test that maps a `TimesNewRomanPS-BoldItalicMT` query to the serif `FontKey`.

## Files touched

- `src/components/workspace/editor-canvas.tsx` — 4 tiny patches (overlay style, text-branch selection, 3 font call-site swaps). No structural change.
- `src/components/workspace/tool-panels.tsx` — at most 1 dispatch added (`SET_TOOL "image"`) if diagnosis confirms it's missing.
- `src/lib/fonts/bridge.ts` — new, ~40 lines.
- `tests/fonts/bridge.test.ts` — new, one test.

## Out of scope

PDF viewer, page render, zoom, tab lifecycle, `samplePageBg`, `openPdf`, existing font modules (`fonts.ts`, `fontMatcher.ts`), `/editor` route, `/redact` route.
