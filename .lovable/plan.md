## Goal

Reach feature parity with `/editor` inside the workspace without violating the one-inspector / no-second-rail rule. Reuse existing logic from `src/lib/editor/*`, `src/lib/outline/*`, `src/components/editor/CommentsPanel.tsx`. No embedding of standalone pages.

## 1. Contextual floating ribbon (full tool parity)

Edit `src/components/workspace/workspace-shell.tsx`:

- Extend `EDITOR_GROUPS` to add the missing drawing tools so the base ribbon matches `/editor`:
  - Shapes group: `rect`, `ellipse`, `line`, `arrow`, `freehand` (icons already imported pattern: `Circle`, `Minus`, `ArrowRight`).
- Keep the ribbon visually calm: only tool icons + undo/redo stay permanent.
- Add a **contextual style strip** that mounts directly under the floating toolbar (same floating surface, second row) and renders ONLY the controls relevant to the active tool OR currently selected annotation. Reuses the same primitives already present in `/editor` (`PALETTE`, stroke/font/opacity number inputs) lifted into a small shared component `src/components/workspace/editor-style-strip.tsx`:
  - text / edit-text / note → color, font size, opacity, B/I/U, align (reuse existing inline text toolbar logic already built in the canvas)
  - highlight / underline / strikethrough → color, opacity
  - rect / ellipse → color, stroke, fill toggle, opacity
  - line / arrow / freehand → color, stroke, opacity
  - image → opacity only
  - select with an annotation selected → mirrors the selected annotation's kind (same mapping)
- Strip hides entirely for `select` with no selection, and for `redact` / `page-crop` (their contextual groups already swap the ribbon).
- Wire it through the same `editorDispatch` already passed into `ToolPanel`. No new state stores.

## 2. Navigation overlay (bookmarks + thumbnails + comments)

New file `src/components/workspace/nav-overlay.tsx`. Single overlay component, three tabs: **Bookmarks**, **Pages**, **Comments**. Opens over the canvas (absolute, right-anchored, dismissible on Esc / outside click / toggle), NOT a permanent rail.

- Trigger: a single icon button in the floating toolbar (left side, before tool groups) + hotkey `⌘B` (toggles overlay, defaults to Bookmarks tab).
- **Bookmarks tab**: reuses `parseOutlineAndLinks` (already used by the Outline & Links inspector) to read the current tab's outline tree. Read-only navigation — click a node → `dispatch({ type: "SET_PAGE", n: dest.page })` and close overlay. Editing stays in the inspector panel.
- **Pages tab**: thumbnail list rendered via existing pdf.js loader (`loadPdfjs`) already used by `linkifyPage`. Click → jump to page. Pure navigation; reorder/rotate/delete remain in the Organize tool (no duplication).
- **Comments tab**: lists all annotations where `contents` is set (filterable: All / Unresolved / Mine). Click → SET_PAGE + select annotation. Resolve / reply actions delegate to the inspector (see §3) by opening it on that annotation.

Overlay uses design tokens only (`surface-2/3`, `border`, `vault`, etc.), no ad-hoc colors.

## 3. Comments — inspector panel for editing

Add a `comments` rail entry under the **Edit** group in `TOOLS` (`src/components/workspace/workspace-shell.tsx`). Add a case in `ToolPanel` (`src/components/workspace/tool-panels.tsx`) that renders a thin wrapper around the existing `src/components/editor/CommentsPanel.tsx` logic — reuse the component's reply/resolve/threaded behavior, restyled to fit the inspector (design tokens, no embedded page chrome). When the nav overlay's Comments tab requests "edit this comment", it sets `activeToolId = "comments"` + selects the annotation.

## 4. Editor route untouched

`/editor` standalone route is not modified, not embedded, not removed. Workspace and `/editor` continue to share `src/lib/editor/state.ts` so annotations are interchangeable.

## Files

- edit `src/components/workspace/workspace-shell.tsx` — extend EDITOR_GROUPS, add overlay trigger + hotkey, add `comments` rail tool, mount style strip + nav overlay
- new  `src/components/workspace/editor-style-strip.tsx` — contextual style controls
- new  `src/components/workspace/nav-overlay.tsx` — bookmarks/pages/comments overlay
- edit `src/components/workspace/tool-panels.tsx` — add `comments` case wrapping reused CommentsPanel

## Rules respected

- Exactly one right inspector; new panels REPLACE its contents.
- No second rail. Navigation overlay is a dismissible floating surface, not a permanent column.
- Canvas actions (style strip) attach to the floating toolbar, not a new toolbar.
- All logic reused from `src/lib/editor`, `src/lib/outline`, `src/components/editor/CommentsPanel.tsx`. No rewrites.
- Design tokens only. 100% on-device.

## Out of scope

- Pages thumbnails for reorder/delete (Organize already owns it).
- New AI features.
- Any change to `/editor` route, persistence model, or export pipeline.