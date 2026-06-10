## Next up — `/outline` (designed structural route)

Per the roadmap build order, `/organize` is done. Next is `/outline` — an editable bookmark tree with a link-annotation inspector. Designed surface: tree on the left, page viewer in the middle, inspector on the right; keyboard-driven.

## Scope

- New route `src/routes/outline.tsx` with full `head()` metadata + JSON-LD.
- Loads a single PDF (tray-aware: pick from tray or drop a new file).
- Parses existing outline + link annotations from the source PDF.
- Lets the user edit them, then exports a new PDF with the changes baked in.

## UI — three-pane designed surface

```text
┌────────────────────┬────────────────────────────────┬──────────────────────┐
│  Outline tree      │  Page viewer (pdf.js canvas)   │  Inspector          │
│  (left, 280px)     │  (center, flex)                │  (right, 320px)     │
│                    │                                │                     │
│  ▸ Chapter 1   p.3 │  [ rendered page ]             │  Selected node      │
│  ▾ Chapter 2   p.9 │                                │  Title              │
│    ◦ Section A p.10│  ┌──────────┐ link rect        │  Page · XY          │
│    ◦ Section B p.14│  └──────────┘                  │  Style (bold/ital)  │
│  ▸ Chapter 3   p.21│                                │  Color              │
│                    │                                │                     │
│  + Add bookmark    │  Draw rect → link              │  Selected link      │
│  Linkify URLs      │                                │  Kind: URL / GoTo   │
└────────────────────┴────────────────────────────────┴──────────────────────┘
```

Keyboard model:
- `↑/↓` move selection, `←/→` collapse/expand
- `Tab` / `Shift+Tab` nest / unnest
- `Enter` rename, `Del` remove, `Cmd/Ctrl+D` duplicate
- `Cmd/Ctrl+L` linkify all URLs on current page
- `[` / `]` previous / next page

## What ships

1. **Outline parsing & editing**
   - Read existing outline via `pdf-lib` low-level (`PDFDict` walk on `/Outlines`).
   - Tree state in Zustand-style local store: `{ id, title, dest: { page, x, y, zoom }, style, color, children[] }`.
   - Add / rename / nest / reorder (drag handle + keyboard) / delete / jump-to.
   - "Jump to page+XY" sets destination from current viewer click.

2. **Link annotations**
   - Read existing `/Annot` entries of subtype `/Link` per page.
   - Drag a rect on the viewer to create a new link; choose URL or in-doc GoTo.
   - Inspector edits URL/dest, color, border.
   - One-click **Linkify URLs**: regex over the text layer, create URL annotations for matches (skip if one already exists at that rect).

3. **Export**
   - Write outline back to `/Outlines` with proper parent/child/prev/next pointers and `/Count` (negative when collapsed).
   - Write link annotations into each page's `/Annots`.
   - Preserve all other content.
   - Output via `downloadBytes()` (same helper Organize uses).

4. **Empty + tray-aware entry**
   - If no file loaded: designed empty state pointing at the tray.
   - If tray has files: chip row to pick which one to outline.

## New files

- `src/routes/outline.tsx` — page shell + three panes
- `src/lib/outline/parse.ts` — read outline + links from a `PDFDocument`
- `src/lib/outline/write.ts` — write outline + links back
- `src/lib/outline/types.ts` — `OutlineNode`, `LinkAnnot`, `Dest`
- `src/lib/outline/linkify.ts` — URL regex + text-layer scan via pdf.js
- `src/components/outline/tree.tsx` — keyboard-driven tree
- `src/components/outline/viewer.tsx` — pdf.js canvas with overlay rect tool
- `src/components/outline/inspector.tsx` — node / link forms

## Nav

Add **Outline** to the "Structure" group in `src/components/app-shell.tsx` (next to Flatten / Page numbers / Header & footer).

## Out of scope (this step)

- No PDF/A export, no crop, no optimize — those are the next steps in the roadmap.
- No batch over tray (outline is per-document).
- No JS validation, no calculations.
- The result-preview-on-every-screen idea is parked; it's a separate task.

## Technical notes

- `pdf-lib` doesn't expose outline helpers, so the read/write modules work on the low-level `context.lookup` / `PDFDict` / `PDFRef` API.
- The viewer uses `loadPdfjs()` to render the current page to a canvas at container width; overlay rect tool uses a positioned `<div>` for drawing, converts to PDF user-space via the viewport transform.
- Link rect storage: PDF user-space rect `[llx, lly, urx, ury]`, computed by inverting the pdf.js viewport.
- Linkify uses pdf.js `getTextContent()` + the standard URL regex; coordinates come from each text item's transform.
- All work is client-only; no new deps.
