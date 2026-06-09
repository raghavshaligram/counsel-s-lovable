
# Annotations + Reader Overhaul

Building a production-grade annotation system that persists as real PDF annotations (Acrobat-compatible) plus a reader-grade viewing shell. No MVP shortcuts.

## Scope

### 1. Shared Annotation Engine (`src/lib/annotations/`)
A canvas + SVG overlay layer that any route can mount on top of a `pdf.js` rendered page.

- **State model**: typed annotation objects (id, page, type, geometry, style, author, createdAt, contents, replies[])
- **Tools**: select, highlight, underline, strikethrough, sticky-note, freehand (ink), rectangle, ellipse, arrow, line, text-box, stamp, image, signature
- **Text-aware tools**: highlight/underline/strikethrough use pdf.js text layer → real `quadPoints` (not just rectangles over rendered pixels)
- **Style controls**: color picker, opacity, stroke width, font size, font family
- **Interactions**: click-to-select, drag-to-move, resize handles, delete (Del/Backspace), undo/redo (Cmd+Z / Cmd+Shift+Z), copy/paste
- **Persistence**: serialize to `pdf-lib` annotation dictionaries on export so Acrobat/Preview see them as native annotations (not flattened pixels). Option to flatten on export.
- **Import**: read existing annotations from uploaded PDFs and render them editable.

### 2. Reader Shell (`src/components/pdf-reader/`)
Reusable viewer used by `/editor`, new `/annotate`, `/sign`, `/redact`.

- Continuous scroll with virtualization (only render visible pages)
- Thumbnail sidebar (collapsible, drag-to-reorder optional per-route)
- Outline / bookmarks panel (parsed from PDF outline)
- Comments sidebar (filtered list of all annotations, click to jump, reply threads)
- Text search with highlight + result counter + next/prev
- Zoom: fit-width, fit-page, actual size, custom %, Ctrl+wheel
- Rotate view (per-session, doesn't mutate doc)
- Hyperlink + internal link support (clicking TOC entry jumps page)
- Keyboard: arrows page, +/- zoom, / for search, Esc deselect

### 3. New Route: `/annotate`
Dedicated annotation workspace using the engine + reader shell. Top toolbar with tool picker, style controls, comments sidebar on right, thumbnails on left.

### 4. Editor Upgrade (`/editor`)
Mount the new reader shell and annotation engine. Existing edit features (add text, image, shapes) become tools within the unified toolbar. Replace current standalone viewer.

### 5. Export Paths
- "Save as PDF with annotations" → annotations as native PDF objects (editable elsewhere)
- "Flatten and export" → burned into page content (final)
- "Export comments" → JSON or CSV of all comments

## Technical Details

- **Libraries already in project**: `pdfjs-dist`, `pdf-lib`. Add `perfect-freehand` for ink smoothing.
- **Text layer**: enable `pdf.js` `TextLayer` to get text selection rects for highlight/underline/strikethrough quadPoints.
- **Annotation dictionaries** (pdf-lib): Highlight, Underline, StrikeOut → `/Subtype /Highlight` with `QuadPoints`; Ink → `/Subtype /Ink` with `InkList`; Text (sticky) → `/Subtype /Text`; FreeText → `/Subtype /FreeText`; Square/Circle/Line → respective subtypes; Stamp → `/Subtype /Stamp` with appearance stream.
- **Undo/redo**: command pattern, stack of inverse ops per document.
- **State store**: Zustand store per open document (`useAnnotationStore`), keyed by doc hash so switching files preserves work.
- **Persistence between sessions**: IndexedDB autosave of unflattened annotation JSON keyed by file hash → reopen same file, restore work.
- **Performance**: virtualize pages, render annotation overlay only for in-view pages, debounce ink point capture, offload pixel diff and heavy ops to web workers.

## File Plan

```
src/lib/annotations/
  types.ts                  shared types
  store.ts                  zustand store + undo/redo
  serialize.ts              pdf-lib export (native + flattened)
  import.ts                 read existing annots from PDF
  quad-points.ts            text-layer rect → quadPoints
  ink.ts                    perfect-freehand wrapper
  hotkeys.ts                shortcut bindings

src/components/pdf-reader/
  PdfReader.tsx             main shell
  PageCanvas.tsx            pdf.js page render + text layer
  AnnotationLayer.tsx       SVG/canvas overlay per page
  Thumbnails.tsx
  Outline.tsx
  CommentsSidebar.tsx
  SearchBar.tsx
  Toolbar.tsx
  ZoomControls.tsx

src/components/annotations/
  ToolPicker.tsx
  StylePanel.tsx
  StickyNote.tsx
  CommentThread.tsx
  StampPicker.tsx
  SignaturePad.tsx (reuse from /sign)

src/routes/
  annotate.tsx              new
  editor.tsx                upgraded to use reader shell
```

## Build Order

1. Annotation types + zustand store + undo/redo + IndexedDB autosave
2. PdfReader shell (continuous scroll, thumbnails, zoom, search) — used standalone first
3. AnnotationLayer + text-aware highlight/underline/strikethrough
4. Drawing tools (ink, shapes, arrow, line)
5. Sticky notes + FreeText + comments sidebar with replies
6. Stamps + signature + image annotations
7. Native PDF export (pdf-lib annotation dicts) + flatten export + import existing
8. New `/annotate` route wiring it all together
9. Migrate `/editor` to the new shell
10. Polish: keyboard shortcuts, empty states, success toasts consistent with rest of app

## Out of Scope (next sprint)

- True text editing of existing PDF text (font subsetting work)
- Form field editor
- Multi-user realtime comments (needs backend)
- Read-aloud, AI summarize integration into reader (will tie chat into reader next)

## Estimated Output

~15 new files, ~2 routes touched, ~3500 LOC. Will ship in iterative commits — engine + reader first (browsable result), then layer in tools.
