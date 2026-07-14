
## Goal

Add four page-management tools to the workspace editor and surface them on the canvas floating toolbar:

1. **Insert Page** – add a blank page (or duplicate current page) before/after a chosen index, at a chosen paper size.
2. **Delete Pages** – delete any range or selection, with an "Auto-detect blank pages" scan.
3. **Page Crop** – already exists as `page-crop`; only needs a toolbar button so it's reachable in one click.
4. **Resize / Scale Pages** – set a target paper size (Letter, A4, etc.) or a % scale, applied to all / selected pages.

All four operate on the in-memory `EditorDoc.pages` (`PageOp[]`) so they respect the three-layer model (srcBytes read-only, edits live in the sidecar, export is the only rebuild point). No new bytes on apply — resize/insert only mutate `PageOp` fields; the change is baked at export time.

## Where things go

### New tool ids in `tool-panels.tsx` registry (group: `pages`, groupLabel: "Organize pages")
- `page-insert` – "Insert Page" (Plus icon)
- `page-delete` – "Delete Pages" (Trash2 icon)
- `page-resize` – "Resize / Scale" (Maximize2 icon)

(`page-crop` and `rotate` already exist in that group.)

### New right-inspector panels in `src/components/workspace/tool-panels.tsx`
- `InsertPagePanel` – position selector (before/after current, at index N, at end), size selector (Same as current / Letter / Legal / A4 / A3 / Custom w×h in pt), count, orientation. "Insert" button dispatches to editor.
- `DeletePagesPanel` – three modes:
  - Current page
  - Range (e.g. `2-4, 7, 10-12`)
  - Auto-detect blanks — button runs a scan; results shown as checklist with per-page thumbnails and "delete selected" action.
- `ResizePagesPanel` – scope (All / Current / Range), mode (Fit to paper size / Scale %), preserve-aspect toggle, "Apply".

Panels use the same `ctx: ToolPanelCtx` pattern the file already exposes.

### Editor state / dispatch (`src/lib/editor/state.ts`)
Add three reducer actions:
- `pages/insert` – `{ atIndex: number; page: PageOp }`
- `pages/delete` – `{ indexes: number[] }`
- `pages/resize` – `{ indexes: number[]; width: number; height: number; scaleContent: boolean }`

`scaleContent: true` also multiplies `cropBox` (if present); export renders the source page onto the new-size page via pdf-lib's `drawPage` with scale, otherwise the page is resized around the existing content (letterbox).

### Export path (`src/lib/editor/export.ts`)
Extend the per-page rebuild to:
- Emit a real blank page (no `drawPage` call) when `PageOp.blank === true` — already flagged in types.
- When target `width`/`height` differ from source page size, create the new-size page and either scale-draw the source (when a `scale` factor is stored) or draw at natural size (letterbox).

A tiny new field `PageOp.scale?: number` (default 1) is added; when present, export multiplies content matrix by it. Cropping already flows through `cropBox`.

### Blank-page detector (`src/lib/pdf/detect-blank.ts`, new)
Rasterize each page at 72 DPI via the shared `pdfDoc` (respects the sacred perf rule — no re-parse), sample luminance histogram, flag pages where >99.5% of pixels are within 3 units of white AND text-content length from `getTextContent` is 0. Returns `number[]` of source-page indexes. Runs in a Web Worker (reuse `rasterize.worker.ts` pattern) so the UI stays responsive on 400-page docs.

### Floating toolbar (`workspace-shell.tsx > FloatingToolbar`)
Add a new "Pages" cluster (between the existing Legal cluster and the editor-tools cluster) with four buttons: Insert Page, Delete Page, Crop Page, Resize Page. Each button calls the existing `onOpenTool(id)` so clicking opens the matching right-inspector panel — mirrors how the Legal cluster already works. No behavior change to text-editing contextual mode.

### Left rail
Registry additions automatically appear under the existing "Organize pages" group. No rail-code change needed.

## Non-goals
- No changes to `/organize` standalone route.
- No new persistence — everything lives in the existing `EditorDoc` sidecar which already persists per `name::size`.
- No AI. Blank detection is pure pixel/text heuristic.

## Files touched
- `src/lib/editor/types.ts` — add optional `PageOp.scale`.
- `src/lib/editor/state.ts` — three new actions.
- `src/lib/editor/export.ts` — honor `blank`, `scale`, resized `width`/`height`.
- `src/lib/pdf/detect-blank.ts` — NEW.
- `src/lib/workers/detect-blank.worker.ts` + client — NEW (small, mirrors rasterize worker).
- `src/components/workspace/tool-panels.tsx` — registry entries + three panels + switch cases.
- `src/components/workspace/workspace-shell.tsx` — Pages cluster in `FloatingToolbar`.

## Verification
- Insert blank Letter page at end → export → re-open → new blank page present at right index.
- Delete pages `2,5` → export → page count reduced by 2, order preserved.
- Auto-detect blanks on a 20-page doc with 3 known blank pages → all 3 flagged, none of the text pages flagged.
- Resize all pages to A4 with scale=true → export → every page is A4 and content visibly fills page.
- Toolbar buttons open matching right-inspector panels; left rail entries do the same.
