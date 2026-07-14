
# Paperlane Design System Alignment + Outcome-Based Sidebar (with Legal preserved)

Same visual refresh. Sidebar is regrouped outcome-first, **but every legal tool stays together under a dedicated Legal group** — not split, not hidden, just moved out of the top slot so general users see a general PDF workspace first.

Not a redesign. Not a feature change. Zero changes to viewer, editor, tool logic, state, routing, or the four-zone layout. Route ids and tool ids unchanged — only labels, grouping, and visual tokens move.

---

## Sidebar — new order

**Current (legal-first, in code today):**
`Legal · Assemble · Edit · Secure · Navigate`

**New (outcome-first for general PDF, Legal kept intact at the bottom):**

| # | Group | Tools (existing ids) | Outcome |
|---|---|---|---|
| 1 | **Review** | Comments · Search inside PDF · Outline & links · Compare versions | "Read, find, diff" |
| 2 | **Organize pages** | Organize · Merge · Split · Extract · Rotate · Page Crop | "Fix the pages" |
| 3 | **Edit & sign** | Sign & Fill · Watermark · Mail Merge | "Add content or sign" |
| 4 | **Convert & compress** | Make Searchable (OCR) · Convert · Image Convert · Compress | "Another form or smaller" |
| 5 | **Protect** | Protect · Unlock · Repair PDF | "General document safety" |
| 6 | **Legal** *(kept as one group, all legal tools together)* | Redact · Sanitize · Privilege review · Pre-Discovery Review · Document Hash · Verifiable redaction · Bates stamp · Exhibit Binder · Table of Authorities · Citation Hyperlinker · Court Readiness · Workflow Builder | Full legal workflow, one place |

Ordering rationale for the Legal group (top → bottom = pre-production → filing):
1. **Redact** — hero tool, first
2. **Sanitize** — metadata scrub, paired with Redact
3. **Privilege review** — AI-assisted classification
4. **Pre-Discovery Review** — bulk pre-production sweep
5. **Document Hash** — evidence integrity
6. **Verifiable redaction** — proof artifact (currently hidden, kept hidden)
7. **Bates stamp** — production numbering
8. **Exhibit Binder** — assembly for filing
9. **Table of Authorities** — brief prep
10. **Citation Hyperlinker** — brief prep
11. **Court Readiness** — final compliance check
12. **Workflow Builder** — automation across the above

Rules:
- **Nothing removed.** Every tool that renders in the rail today still renders.
- **Legal stays whole.** Redact, Sanitize, Document Hash — not split into Protect. Only PDF-generic safety tools (Protect / Unlock / Repair) live under Protect.
- **Tool ids unchanged** — `redact`, `bates`, `sanitize`, `document-hash`, etc. keep working. Deep links (`?tool=…`) keep working. `initialTool` search-param keeps working.
- **Labels normalized** — "Redact for production" → "Redact"; "Make Searchable" kept; other legal labels kept as-is inside the Legal group where jargon is appropriate.
- **Legal group expanded by default** for the current audience; collapsible with persisted state. When we broaden the audience later, we flip the default to collapsed with a one-line change.
- **Section headers** use the new type token (`--text-xs --weight-medium ink-3 uppercase tracking-tight`).
- **Active tool** = `accent-soft` bg + 2-px accent left border + `ink` text.

Files touched for the regroup (data + styling only, no logic):
- `src/components/workspace/workspace-shell.tsx` — update each `TOOLS` entry's `group` / `groupLabel`, update `TOOL_GROUP_ORDER` and `RAIL_GROUP_ORDER` to the new order, add persisted collapse state per group.
- No changes to routes, handlers, tool panels, or the "All tools" modal beyond the same relabel.

---

## Design commitments (unchanged)

Linear · Raycast · Arc · Figma register. High density, elevation over borders, 8-px spacing, 10-px radius, one accent, two themes (Light default + Dark evolved). No gradients on chrome, no glass, no bubble UI, no motion beyond 150 ms.

## Accent — three options, default Modern Indigo

| Option | Light | Dark | Status |
|---|---|---|---|
| **A · Modern Indigo** | `#4F46E5` | `#6366F1` | **Default** |
| B · Slate Blue | `#5B7FA6` | `#7A9BC2` | One-line swap |
| C · Deep Teal | `#0F766E` | `#14B8A6` | One-line swap |

## Token layer (new `src/design/tokens.css`)

**Dark (charcoal):** `--bg #0E0F13 · surface-1 #15171C · 2 #1B1E24 · 3 #23272F · 4 #2C3038`, `hairline .06 / divider .10`, ink `#E6E8EC / #A9B0BC / #6E7684 / #4A5160`.
**Light:** `--bg #FAFAFB · surface-1 #FFF · 2 #F5F6F8 · 3 #EEEFF2 · 4 #E4E6EB`, `hairline .06 / divider .10`, ink `#12141A / #4A5160 / #6E7684 / #A9B0BC`.
**Accent (Indigo):** dark `#6366F1` / hover `#7C7FF5` / soft `.14` · light `#4F46E5` / hover `#4338CA` / soft `.10`.
**Status:** success `#34D399/#059669` · warning `#F5B454/#B7791F` · error `#F87171/#DC2626`.
**Elevation:** `1: 0 1px 2px .20 · 2: 0 4px 12px .28 · 3: 0 12px 32px .36` (light `.06/.10/.14`).
**Spacing:** `4 · 8 · 12 · 16 · 24 · 32 · 48`.
**Radius:** `sm 6 · md 10 · lg 12 · xl 14`. No pills.
**Type:** Inter body, JetBrains mono. `xs 11 · sm 12 · md 13 · lg 15 · xl 18`. Weights `400 · 500 · 600`. Display serif retired from product chrome.
**Motion:** `100 · 150 · 220 ms`, ease `cubic-bezier(0.2,0.8,0.2,1)`. No spring.

## Primitives (variants only, no API changes)

`src/components/ui/*.tsx` restyled: `Button` (primary/secondary/ghost/icon, 28/32/36, no pill), `Input`/`Select`/`Textarea` (surface-2, hairline, 32, 1.5-px accent focus ring), `Card` (surface-2, no border, elev-1, radius-md, space-4), `Dialog` (surface-2, radius-lg, elev-3), `Popover`/`Menu` (surface-3, radius-md, elev-2, accent-soft active), `Chip`/`Badge` (radius-sm, xs, medium, one shape), `Table` (32 row, hover surface-3, selected accent-soft + 2-px left border, hairline rows only), `Tabs` (2-px underline), `Tooltip` (surface-4), `Toggle`/`Switch`, `Toast` (surface-3, left-border accent by status).

## Theme provider

`src/design/theme-provider.tsx` — light / dark / system, persisted, sets `class="dark"` on `<html>`. Wrapped in `src/routes/__root.tsx`. Toggle added to account menu.

## Workspace chrome (styling only)

- `workspace-shell.tsx` — sidebar bg `surface-1`, hover `surface-2`, active `accent-soft` + 2-px accent left border; icons 16 px; section headers per type token; **new outcome-first order with Legal kept whole at the bottom**; per-group collapse persisted.
- `tool-panels.tsx` — inspector cards through new `Card` primitive.
- `tab-strip.tsx`, `announcement-banner.tsx`, `jobs-indicator.tsx`, `quick-actions-menu.tsx`, `account-menu.tsx`, `nav-overlay.tsx`, `support-chips.tsx` — hex → tokens.
- `editor-canvas.tsx` — backdrop `--bg`, paper unchanged (`#F7F5EE`).

## Anti-drift

- ESLint `no-restricted-syntax` blocks hex literals in `src/components/**` and `bg-white` / `text-black` / `bg-[#…]`.
- One-time codemod fixes existing violations.
- `docs/DESIGN_SYSTEM.md` — token table, primitive list, "never hardcode a hex". Referenced from `mem://index.md` Core.

## Explicitly preserved

Document viewer · pdf.js worker · page composition · editor state / reducer / sidecar / undo/redo / export · all `src/lib/pdf/**`, `src/lib/editor/**`, `src/lib/workers/**` logic · routing, params, guards, deep links · four-zone layout · every tool that renders today · paper color inside canvas.

## Verification

1. `bun run build` clean; `bun run test` green
2. Visual smoke on `/workspace` — new sidebar groups (all 6, Legal expanded), 3 tool panels, 1 dialog, 1 popover — both themes
3. Deep-link smoke: `/workspace?tool=redact · ?tool=bates · ?tool=sanitize · ?tool=ocr · ?tool=privilege-scan · ?tool=document-hash` all activate the correct panel from their new groups
4. `pdfDoc` still parsed once (grep confirms no `getDocument` regressions)
5. `e2e/redaction.e2e.spec.ts` green
6. Contrast ≥ WCAG AA in both themes
7. No `#[0-9a-fA-F]{6}` literals in `src/components/**`
8. Per-group collapse state persists across reloads

## Deliberately out of scope

Automation Mode UI. Marketing pages. New iconography. Illustration. Motion beyond the 3 duration tokens. Any layout structural change.

## Rollout — single PR, revertable commits

1. Tokens + theme provider + toggle (invisible)
2. Primitive re-styling
3. Workspace chrome token migration
4. **Sidebar regroup + relabel** (outcome-first, Legal kept whole, ordered pre-production → filing)
5. ESLint guard + codemod
6. `DESIGN_SYSTEM.md` + memory update
