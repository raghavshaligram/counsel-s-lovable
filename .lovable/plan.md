## Goal

Tame the sidebar so new tools slot into a stable taxonomy, and move the VaultPDF logo into the top header so the sidebar can collapse cleanly to icons.

## New navigation layout

Collapse the current 3 flat groups (16 items and growing) into **3 top-level categories**, each with named subgroups. Subgroups are visual labels inside the same `SidebarGroup` — no extra clicks, just clearer scanning. Order is intent-first: what people came to do.

### 1. Secure
Privacy-forward actions — the brand promise.
- Redact (AI)
- Protect (password)
- Unlock (remove password)
- Sign & Fill

### 2. Edit
Modify the PDF you already have.
- Editor
- Split
- Rotate
- Watermark
- Compress
- Make Searchable (OCR)

### 3. Convert & Extract
Move data in/out of PDF.
- *Subgroup — From PDF:* PDF → Word, PDF → Images, Extract (tables/text), Search inside PDF
- *Subgroup — To PDF:* Images → PDF, Mail Merge

Future tools land naturally: *Reorder pages* → Edit; *Compare* → Edit (or its own "Review" subgroup once 2+ exist); *Word → PDF* → Convert/To PDF.

When we cross ~8 items in a single category, we promote a subgroup label inline (same pattern) instead of inventing a new top-level group. This keeps the top-level count at 3 indefinitely.

## Header logo move

- Remove the logo block from `SidebarHeader`. Keep `SidebarHeader` (empty or just spacing) so the collapse rail still aligns.
- In the top `<header>`, place the brand on the far left, immediately right of `SidebarTrigger`:
  - `SidebarTrigger` · `[lock-mark] VaultPDF` · `100% in your browser` (hidden on small)
  - Right side keeps the Lifetime deal pill.
- Brand is a `<Link to="/">`, uses existing `bg-vault` lock mark + display font, sized to match the 14-px header (h-7 mark, text-[17px]).

## Technical notes

- File touched: `src/components/app-shell.tsx` only.
- Replace `heroTools` / `converters` / `utilities` arrays with the 3 new arrays. For *Convert & Extract*, model subgroups as `{ label, items: [...] }[]` and render a small `SidebarGroupLabel`-styled `<div>` (text-[10px] uppercase tracking-wide muted) above each subgroup's `SidebarMenu` inside one `SidebarGroup`. No new shadcn primitives needed.
- Keep `collapsible="icon"` behavior — subgroup labels hide via `group-data-[collapsible=icon]:hidden` so the icon rail stays clean.
- No route changes, no new icons required (reuse existing).
