# Intelligent Action Bar — Plan

## Recommendations on the open questions

1. **Top toolbar** — keep it, but slim it down. The top-center bar becomes chrome-only: Nav toggle, tool switcher (Select / Text / Highlight / Shapes / Image / Note), Legal tools (Redact / Sign / Link), Undo / Redo. The new Intelligent Action Bar owns everything that depends on a *selected object* — no duplicate controls. Rationale: paralegals still need a reliable place to pick a tool when nothing is selected; a purely selection-following bar leaves cold-start users stranded.
2. **Missing actions** — render the full primary rows as specified, wire the ones that map to existing logic today, stub the rest with a small `Tip` ("Coming soon") and a toast. This locks in the intelligent shape and the muscle memory now; follow-ups fill the gaps without touching the bar again. Concretely: Duplicate, Bring Forward / Send Backward, Replace (image), Crop (image), Extract (image), Reset Crop, Duplicate Style, Done / Cancel (text edit), Flatten (signature), Mark Entire Line, Burn Redactions, Preview Burn → wireable. Match Original Font, Replace Font, Replace Everywhere, Find Similar Text, Apply To Similar, AI Enhance, Compress (single image), Apply To Pages, Verify (signature), Apply Same Crop → stubs with toast.
3. **Signatures** — tag them at insertion. When `signature-creators` / Sign & Fill drops an image annotation, set `meta.signature = true` on the annotation. The action bar reads that flag to switch from the Image primary set to the Signature primary set. Zero schema churn, zero risk to the editor pipeline.

## Scope guardrails (unchanged files)

Do NOT touch: `editor-canvas.tsx` (canvas / open lifecycle / samplePageBg), PDF viewer, tab lifecycle, `src/lib/editor/state.ts` reducer semantics, `exportEditedPdf`. The existing text-edit mini-toolbar inside `editor-canvas.tsx` stays as-is for in-place typing UX; the Intelligent Action Bar mirrors its Done / Cancel / Match Original / Replace Font / Apply To Similar row *around* the edited box but does not replace the caret-adjacent chrome.

## Architecture

New folder: `src/components/workspace/action-bar/`

```text
action-bar/
  IntelligentActionBar.tsx   ← positioning + framer-motion transitions + section layout
  useActionBarTarget.ts      ← resolves selection → { kind, rect, state } target descriptor
  usePositioner.ts           ← auto-flip above/below/left/right, viewport-aware, avoids covering selection
  registry.ts                ← ACTION_SETS keyed by target kind + workflow stage
  actions/
    text.ts                  ← primary + properties for text / text-edit
    image.ts                 ← image + signature variants
    redaction.ts
    shape.ts
    mark.ts                  ← highlight/underline/strikethrough
  primitives/
    ActionButton.tsx         ← primary button (label + icon, compact)
    PropertyControl.tsx      ← property row atoms (color swatch, slider, toggle)
    Section.tsx              ← Primary / Properties separator with subtle divider
  types.ts
```

- Rendered once at the workspace canvas layer, positioned absolutely against the canvas container using the selected annotation's page-space rect projected through the existing viewport transform (reuse the same rect math the current selection outline uses in `editor-canvas.tsx` — read-only, no edits there).
- `framer-motion` (already installed) drives layout transitions between action sets — `<motion.div layout>` on the container, `AnimatePresence` per row, so buttons slide/fade instead of the whole bar rebuilding.

## Target resolution (`useActionBarTarget`)

Reads the editor reducer state + active tool. Returns one of:

- `{ kind: 'none' }` — no selection, no draw tool → bar hidden.
- `{ kind: 'text', anno, editing: false }`
- `{ kind: 'text', anno, editing: true }` — while the caret is inside a text-edit box
- `{ kind: 'image', anno, isSignature: !!anno.meta?.signature }`
- `{ kind: 'redaction', anno }`
- `{ kind: 'shape', anno, subKind: 'rect'|'ellipse'|'line'|'arrow'|'freehand' }`
- `{ kind: 'mark', anno, subKind: 'highlight'|'underline'|'strikethrough' }`
- `{ kind: 'draw-tool', tool }` — a draw tool is active with nothing selected; bar shows the "next draw" property row only, no primary section.

A `workflowStage` field on the target tracks what just happened (see Behavior). Stored in a small `useReducer` local to the bar, keyed by `anno.id + kind`.

## Positioning (`usePositioner`)

Inputs: selection rect (canvas-space), bar measured size, canvas viewport rect.

Algorithm: prefer **below** the selection with 8px gap. If not enough space, try **above**, then **right**, then **left**. If none fit without overlap, dock at the nearest canvas edge and pin. Never overlap the selection when any side has ≥ bar height + 16px. Recomputes on: selection change, scroll, zoom, viewport resize (ResizeObserver on canvas + IntersectionObserver on selection outline sentinel already present).

The bar animates its position with `layout` transitions (spring, low stiffness) so it glides between targets rather than teleporting.

## Action sets (registry)

Each entry: `{ primary: Action[], properties: PropertyControl[] }`. `Action` = `{ id, label, icon, onRun(ctx), enabled?, hidden?, stub? }`. `ctx` exposes `{ state, dispatch, anno, openInspector(id), toast, setStage }`.

### Text — selected, not editing
Primary: Match Original Font*, Replace Font*, Replace Everywhere*, Find Similar Text*, Duplicate Style
Properties: Font, Size, Bold, Italic, Underline, Color, Alignment (reuses the existing `TextEditPropsBar` control atoms — extracted into `primitives/`).

### Text — editing (caret inside box)
Primary: Done, Cancel, Match Original*, Replace Font*, Apply To Similar*
Properties: hidden (in-canvas mini-toolbar handles inline formatting).

### Image — plain
Primary: Replace, Crop, Compress*, Extract, AI Enhance*
Properties: Opacity, Rotation, Arrange (Bring Forward / Send Backward)

### Image — signature (`meta.signature === true`)
Primary: Replace, Duplicate, Flatten, Verify*
Properties: Opacity, Rotation

### Redaction (`kind === 'redact'`)
Primary: Preview Burn, Find Similar*, Mark Entire Line, Apply To Pages*, Burn Redactions
Properties: Color, Opacity

### Shape (`rect / ellipse / line / arrow / freehand`)
Primary: Duplicate, Bring Forward, Send Backward
Properties: Fill (rect/ellipse only), Stroke color, Thickness, Opacity

### Mark (`highlight / underline / strikethrough`)
Primary: Duplicate Style, Find Similar Text*
Properties: Color, Opacity

*= stubbed with toast + tooltip "Coming soon" in this pass.

## Adaptive behavior

Small state machine per selection tracks `lastAction`:

- Text — after a font change → swap `Replace Font` with `Apply To Similar` + `Replace Everywhere`. Reverts on new selection.
- Image — after a crop commit → swap `Crop` with `Reset Crop` + `Apply Same Crop`. Reverts on selection change or explicit Reset.
- Redaction — after `Preview Burn` → swap it with `Commit Burn` + `Undo Preview`.
- Shape — after Duplicate → briefly (2s) show `Duplicate Again` in place of `Duplicate` so repeat clicks are one-target.

Transitions use `AnimatePresence mode="popLayout"` so the button morphs rather than the row jumping.

## Signature tagging (minimal integration)

- `signature-creators.tsx` (and any Sign & Fill drop path) currently dispatches an `ADD_ANNO` for an image. Add `meta: { signature: true, source: 'signature-creator' }` to that anno. The reducer already spreads `patch` on `ADD_ANNO`, so `meta` rides through without state.ts changes. `types.ts` gains an optional `meta?: Record<string, unknown>` on the anno base — additive, non-breaking.

## Top-bar slim-down

`FloatingToolbar` in `workspace-shell.tsx` keeps: Nav toggle, Legal (Redact / Sign / Link), tool switcher groups (Select, Text, Highlight/Underline/Strike, Note, Image/Shapes), Undo/Redo. Removes: Delete Selected (moves into Intelligent Action Bar as a properties-row trailing button on every kind).

## Files touched

**New:** the `action-bar/` tree above (~9 files).

**Edited (surgical):**
- `src/components/workspace/workspace-shell.tsx` — mount `<IntelligentActionBar />` inside the canvas frame next to `<FloatingToolbar>`; remove Delete button from top bar; pass reducer state + dispatch + `openInspector`.
- `src/components/workspace/signature-creators.tsx` — set `meta.signature = true` on inserted image anno.
- `src/lib/editor/types.ts` — add optional `meta?: Record<string, unknown>` to anno base type.

**Not touched:** `editor-canvas.tsx`, `state.ts` reducer, PDF viewer, tab lifecycle, `samplePageBg`, export pipeline, font resolver.

## Design tokens

- Container: `bg-surface-3`, `border border-border`, `borderRadius: 12`, `boxShadow: var(--shadow-float)`, 6px vertical padding, 8px horizontal.
- Sections separated by a 1px `bg-border` divider with 6px vertical gap. Primary row uses labeled buttons (icon + text, `text-[12px]`, `h-7`). Properties row uses compact icon-only controls (`h-6 w-6`).
- Motion: spring `{ stiffness: 320, damping: 32 }` for position + layout, 120ms fade for button add/remove.
- Steel-blue accent (`--vault`) only on active/toggled property controls, consistent with project rule.

## Verification

- Unit: `tests/action-bar/registry.test.ts` — snapshot each action set + adaptive stage transitions.
- Unit: `tests/action-bar/positioner.test.ts` — flip logic for 8 selection positions × 4 viewport edges.
- Manual: Playwright script that selects a text box, image, redaction, shape, mark; screenshots the bar in each state and after each adaptive trigger; verifies it never overlaps the selection when space exists.
