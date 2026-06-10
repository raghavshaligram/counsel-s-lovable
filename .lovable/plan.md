# /crop + Editor "Document Ops" menu

Two related deliverables in one pass. They share the new modular `apply()` functions so the editor and the dedicated routes never drift apart.

## 1. New route `/crop`

Designed standalone tool — same shell pattern as `/organize`, `/outline`.

### Surface
```
┌──────────────────┬─────────────────────────────────┬──────────────────┐
│ Page rail (left) │ Page canvas + rulers (center)   │ Inspector (right)│
│ thumbnails       │ drag crop box, snap to margins  │ presets, margins │
│ multi-select     │ rulers in pt / in / mm          │ apply scope      │
└──────────────────┴─────────────────────────────────┴──────────────────┘
```

### Features
- pdf.js page render with overlay drag box (4 handles + edges).
- Rulers along top + left, unit toggle (pt / in / mm).
- Inspector fields: top / right / bottom / left margins (live two-way bind with box).
- Presets: A4 / Letter content margin, "trim 1 cm", "tight to content", custom.
- **Auto-detect content bounds**: render page at 2× into off-screen canvas, alpha-scan to find non-white bbox, snap crop to it (+ small padding).
- Scope toggle: "this page", "all pages", "odd / even", "current selection from rail".
- Optionally also rewrite `/MediaBox` (default just `/CropBox`).
- Export via `downloadBytes`, name `<orig>-cropped.pdf`.

### Files
- `src/lib/crop/apply.ts` — pure `applyCrop(bytes, pageIdx[], rect, { mediaBoxToo })` returning new bytes (pdf-lib, no UI).
- `src/lib/crop/detect.ts` — `detectContentBounds(bytes, pageIdx)` using pdf.js + canvas alpha scan.
- `src/lib/crop/types.ts` — `CropRect`, `CropUnit`, `CropScope`.
- `src/routes/crop.tsx` — full route, three-pane shell, ToolHeader, tray-aware.

### Nav
Add **Crop** to the "Structure" group in `src/components/app-shell.tsx`.

## 2. Editor "Document Ops" menu

`/editor` already handles per-annotation tools. We add a separate **Apply** button in the toolbar that opens a popover/menu running document-level ops on the loaded PDF in place. State stays in the editor doc; ops re-import the resulting bytes so the editor reflects the change immediately.

### Ops added
- **Page numbers** → reuse `src/lib/batch/ops/page-numbers.ts`
- **Header & footer** → reuse `src/lib/batch/ops/header-footer.ts`
- **Flatten annotations** → reuse `src/lib/batch/ops/flatten.ts`
- **Crop** → new `src/lib/crop/apply.ts` (built above)

Each op opens a small designed dialog with the same field set as the dedicated route (preset, position, margins, etc.), then:

1. Reads current editor bytes (snapshot of the loaded PDF + any in-memory annotations exported once via existing `exportPdf`).
2. Runs the op (`Uint8Array → Uint8Array`).
3. Re-imports the result into the editor (`loadDoc(bytes)`), preserving page selection.
4. Toasts "Page numbers applied — undo with Ctrl+Z" *(undo for these doc-level ops is a single snapshot on the editor's history stack)*.

### Files
- `src/components/editor/doc-ops-menu.tsx` — popover button (Hash, Crop, Header/Footer, Layers icons) + per-op dialog.
- `src/components/editor/dialogs/page-numbers-dialog.tsx`
- `src/components/editor/dialogs/header-footer-dialog.tsx`
- `src/components/editor/dialogs/crop-dialog.tsx` (compact, single-page-or-all)
- `src/components/editor/dialogs/flatten-dialog.tsx` (just a confirm + scope)
- Tiny edit in `src/routes/editor.tsx` Toolbar to mount the new menu.

### Why a menu, not new toolbar tools
The existing toolbar tools (`select`, `text`, `rect`…) all paint *annotations* on a single page. Page numbers / crop / header-footer / flatten mutate the *document bytes*. Mixing them into the same row confuses the mode model and breaks the per-page cursor mapping. A separate "Apply" menu keeps modes clean and matches the way users think about these ops.

## Out of scope (this step)
- `/optimize`, PDF/A, batch-over-tray for crop (will come after this lands).
- Shared `PdfResultPreview` component (separate parked task).
- No new deps.

## Technical notes
- Crop math: pdf-lib `page.setCropBox(x, y, w, h)`. Coordinates are PDF user-space (origin bottom-left). pdf.js viewport returns top-left; invert via `viewport.height - y`.
- Auto-detect: render at scale=2, walk pixels with stride 4, find min/max x,y where alpha>0 OR rgb < 250. Add 6 pt padding, clamp to mediabox.
- Editor reimport: existing `loadDoc(bytes)` already rebuilds thumbnails + page state, so we just call it with the op's result.
- All ops are pure `Uint8Array → Uint8Array`, so the dedicated routes and the editor menu call the same function.
