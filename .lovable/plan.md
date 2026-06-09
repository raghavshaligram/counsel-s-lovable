## Replace sidebar with top nav + mega menu

### Layout change

- Delete the left `Sidebar` entirely from `src/components/app-shell.tsx`.
- The top header becomes the primary nav, full width, sticky, backdrop-blurred.
- Main content gets the whole viewport width — no more left rail eating space.

### Top bar structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ 🔒 VaultPDF │ All tools ▾ │ Organize ▾  Convert ▾  Edit ▾  …  │  Lifetime deal │
└──────────────────────────────────────────────────────────────────┘
```

- **Left:** VaultPDF wordmark (links home).
- **Center:** 5 group triggers (Organize, Convert, Edit, Secure, AI). Each opens a mega-menu panel on hover/click. "Optimize" merges into Edit (just Compress) to keep the bar at 5.
- **Right:** "Lifetime deal" pill (kept) + "100% in your browser" trust line on wide screens.

### Mega menu panel

Built with shadcn `NavigationMenu` (already in the stack) — no new deps.

- Panel is full-width-of-container, drops below the header with a soft shadow and the same backdrop-blur as the header.
- Inside each panel: a 2-column grid of tool cards.
  - Each card = icon tile (40×40, vault-tinted) + tool name + one-line description (the `desc` strings we already had on the old `heroTools` / `converters` / `utilities` arrays — restoring them).
  - Hover lifts the card and brightens the icon tile.
- Right edge of each panel: a small "featured" block — for now a static illustration/icon + the tagline for that category (e.g. Organize → "Move pages around without uploading them"). Keeps the mega-menu visually rich rather than a bare grid.

### Mobile (`< md`)

- Replace the mega menu with a single hamburger that opens a shadcn `Sheet` from the right.
- Sheet contains the same grouped tool list, scrollable, with normal scrollbars.

### Tool data

One source of truth at the top of `app-shell.tsx`:

```ts
const groups = [
  { id: "organize", label: "Organize", tagline: "...", items: [{ to, label, desc, icon }, ...] },
  ...
];
```

Same `to` / `icon` set as today; `desc` strings come back from the pre-redesign version.

### Scrollbars

No change to global scrollbar behavior — global scrollbars stay visible (already restored last turn). The `.no-scrollbar` utility stays in `styles.css` but is no longer used; can remove later if unused.

### Files touched

- `src/components/app-shell.tsx` — rewrite: drop `Sidebar*` imports, add `NavigationMenu` + `Sheet` based top nav. Keep header CTA + footer + the existing custom icon components.
- No other files.

### Out of scope

- No images yet — using existing lucide-style custom icons + tinted tiles. If you want real illustrations per category later, that's a follow-up (one image per group, 5 total).
- No route changes.
- No changes to any individual tool page.
