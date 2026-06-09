## Fix scrollbars + redesign sidebar

### 1. Restore global scrollbars

- Remove the global `* { scrollbar-width: none }` + `::-webkit-scrollbar { display: none }` block I added to `src/styles.css`. Normal scrollbars come back everywhere (page, modals, dropdowns, etc.).
- Scope the hide rule to the sidebar only via a `.no-scrollbar` utility class, and apply it to the sidebar's scroll container (`SidebarContent`).

### 2. New sidebar design — every tool reachable without digging

Problems with the current sidebar:
- Convert and Utilities are inside `Collapsible` groups that are `defaultOpen={false}`, so 13 of 18 tools are hidden behind two clicks.
- Defaults to collapsed (`defaultOpen={false}` on `SidebarProvider`), so you land on an icon rail with no labels.
- Hero/Convert/Utilities split is arbitrary — Rotate and Split live under "Utilities" while Merge sits under "Core."

Proposed structure:

- **Default state:** sidebar open on desktop (`defaultOpen={true}`), still collapsible to icon rail via the header trigger.
- **Flat, scannable groups — all expanded by default, no collapsibles:**
  - `Organize` — Merge, Split, Rotate, Extract
  - `Convert` — PDF→Word, Word→PDF, PDF→Images, Images→PDF
  - `Edit` — Editor, Sign & Fill, Watermark, Redact
  - `Secure` — Protect, Unlock, Compare, Make Searchable (OCR)
  - `Optimize` — Compress
  - `AI` — Search inside PDF (Beta), Mail Merge
- Replace `Collapsible` wrappers with plain `SidebarGroup` blocks so labels + items are always visible.
- Sidebar body uses the new `.no-scrollbar` class — scrolls when the list overflows, but no visible scrollbar (this was the user's original ask).
- Keep the Lifetime deal CTA + "Files never leave this tab" footer.
- Keep `collapsible="icon"` so the trigger still gives a compact icon-only mode for users who want screen space.

### 3. Files touched

- `src/styles.css` — drop the global scrollbar-hide block; add a single `.no-scrollbar` utility.
- `src/components/app-shell.tsx` — regroup tools, remove `Collapsible` wrappers, flip `defaultOpen` to `true`, add `.no-scrollbar` to `SidebarContent`.

No other files, no behavior changes to the tools themselves.
