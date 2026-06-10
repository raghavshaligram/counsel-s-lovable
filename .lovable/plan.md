# Phase 5 — Redact as a real editor

Restructure `src/components/redact-page.tsx` so the canvas is the hero, not the chrome. Three structural moves, then polish.

## Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ ToolHeader (slim, sticky)                                    │
├──┬────┬──────────────────────────────────────────┬───────────┤
│TR│ TH │                                          │ INSPECTOR │
│  │ U  │           CANVAS (dark, full-bleed)      │           │
│  │ M  │                                          │ • Pending │
│  │ B  │           pages render here              │   review  │
│  │ S  │                                          │ • PII cats│
│  │    │                                          │ • Find    │
│  │    │                                          │ • Export  │
└──┴────┴──────────────────────────────────────────┴───────────┘
 48px  72px                                          320px
 tool  page                                          right rail
 rail  thumbs
```

## Structural moves

1. **Tool rail (left, 48px)** — vertical icon buttons replacing the Label/Detect/Find tabs: Select, Box, Auto-detect, Find, Label-picker. Active tool gets amber bar + filled bg. Tooltips on hover. Keyboard: V / B / D / F / L.

2. **Thumbnail strip (72px)** — `pages.map` rendered at ~60px wide, current page highlighted amber, pages containing redactions get a small `--evidence` tick. Click to scroll page into view.

3. **Inspector (right, 320px)** — single scrollable panel replacing the tab block. Sections (serif small-caps headers):
   - **Pending review** (only when `pendingDetections` / `pendingMatches` set) — count, category breakdown, Cancel / Redact buttons in `--evidence`.
   - **PII categories** — count-first pills (`● SSN 12`, `○ Phone 0`), click to toggle.
   - **Find & redact** — query input, case/whole-word toggles, Search button.
   - **Label** — default exemption picker (Select from `EXEMPTION_PRESETS`).
   - **Export** — Strip metadata switch, premium-only Certificate / Privilege log switches, primary Export button.

4. **Canvas** — `bg-surface-canvas`, pages stacked with generous gap, current page outlined. Pending boxes pulse in `--evidence`; committed boxes solid. Dim canvas to 40% when pending review is active.

## Polish

- Mono numerals (`font-mono`) for all counts, page numbers, hash prefixes, file sizes.
- Serif small-caps section headers (`font-display`, `text-[11px]`, `tracking-[0.08em]`, `uppercase`).
- Premium surface (`/verifiable-redaction`): amber left rule on canvas, `VERIFIABLE` badge top-right of ToolHeader with SHA-256 prefix in mono, export button label becomes `Sign & Export`.
- Empty state: render the full chrome greyed out with `FileDropzone` centered in the canvas area — show users what they're getting before they upload.
- Export becomes a dialog (filename preview, options, single amber `Burn & Export` button) — proportional friction for irreversible action.

## Out of scope (defer)

- Full Procreate-style stamp picker on the tool rail (use Select for now).
- Animated review ceremony (use static pulse + dim, skip the bottom-center card animation).
- Saving exemption presets to localStorage beyond the existing `defaultLabel`.

## Files

- `src/components/redact-page.tsx` — main restructure (keep all state/logic; only the JSX layout + small subcomponents change).
- No new dependencies. No backend changes.

## Verification

- `tsc --noEmit` clean.
- Upload a 2-page PDF, run auto-detect, confirm pending review surfaces in inspector, redact, export.
- Switch between `/redact` and `/verifiable-redaction` — premium chrome differences visible.
