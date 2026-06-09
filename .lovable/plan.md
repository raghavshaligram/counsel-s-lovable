# VaultPDF — Design Overhaul Plan

Goal: stop looking like a generic SaaS dashboard. Make the redaction flow the most opinionated, tactile, editorial document tool on the web. Ship in 4 phases so each one is shippable on its own.

---

## Phase 1 — Foundation (tokens, type, nav)

Touches every screen. No feature work; pure visual reset.

1. **Type system** in `src/styles.css`
   - Add Instrument Serif (display) and JetBrains Mono (numerics) alongside existing sans.
   - New tokens: `--font-display`, `--font-mono`, fluid type scale (`--text-display`, `--text-h1` … `--text-micro`) using `clamp()`.
   - Kill all-caps tracking labels; replace with sentence-case + size hierarchy.

2. **Color + surface tokens**
   - Add `--vault-amber` (premium accent), `--evidence-red` (destructive/critical), `--surface-canvas` (deep neutral for the editor backdrop, distinct from page bg).
   - Add `--shadow-stamp` (used by redaction boxes) and `--shadow-float` (used by floating toolbars).

3. **Nav simplification** in `src/components/app-shell.tsx`
   - Top-level: Redact, Sign & Fill, Protect, Compress, Editor + "All tools" disclosure.
   - Move everything else into the disclosure mega-menu (already exists, just trim the visible bar).
   - Keep current active-route highlight behaviour.

---

## Phase 2 — Redact canvas as the hero

Where most of the visual payoff lives. All in `src/components/redact-page.tsx`.

1. **Layout flip**: canvas grows to ~78% of viewport; tools collapse into a **bottom command bar** (Photoshop options-bar pattern) instead of the right side tabs. Tabs become bar segments: Label · Detect · Find · Export.
2. **Floating export cluster** top-right of canvas (Export / Certificate / Privilege log on premium).
3. **Redaction box restyle** — render boxes as "evidence stamps":
   - 2px outer ring in `--evidence-red` on hover/selected, solid black fill at rest.
   - SVG hash pattern fill (45° lines) instead of flat black.
   - 4px bleed past selection bbox.
   - Drop `--shadow-stamp` underneath; subtle.
4. **Stamp-on animation** — when a box is committed, scale from 1.08 → 1.0 with a 120ms ease-out + opacity 0 → 1. Use framer-motion (already a dep? confirm before adding).

---

## Phase 3 — Detect moment + premium differentiation

1. **UV-sweep detect animation** in `src/lib/pdf/detect-pii.ts` consumer:
   - During the `detect()` call, overlay a vertical gradient bar that sweeps top→bottom of the visible page at ~600ms.
   - As detections land, color-code per `CATEGORY_META`: SSN/card → red, email → blue, phone → amber, date → muted, IP/IBAN → violet.
   - Minimap on canvas right edge: thin column with one dot per page, colored by densest category — click to jump.

2. **Premium-tier visual identity** (`/verifiable-redaction` only — gate via `useRouterState` already in `redact-page.tsx`):
   - Header swap: serif wordmark + amber underline + live SHA-256 prefix chip (`sha256: 4f2a…`) in mono.
   - Replace the standard red destructive accent with `--vault-amber` for primary actions; `--evidence-red` reserved strictly for "destroy text layer / export".
   - Add a small wax-seal SVG mark next to "Verifiable" in the tool header.

---

## Phase 4 — Landing page rewrite

`src/routes/index.tsx`.

1. Replace tool grid hero with a **live embedded redact canvas** — a 2-page sample PDF, user can drag a box, see real stamp animation, watch certificate preview update on the right. No upload, no signup.
2. **"100% in your browser"** as a massive serif statement below the demo with a small green pulse dot + "no bytes leave this tab" mono caption.
3. Move the full tool grid to `/tools` (new thin route) linked as "All 18 tools →".
4. Footer: trim to legal + GitHub + status; remove the marketing column noise.

---

## Technical notes

- **No new heavy deps.** framer-motion only if not already installed (check `package.json` before adding).
- **SSR-safe:** canvas demo on landing must be `client:only` — wrap in a dynamic import + `useEffect` mount guard so SSR renders a static poster image, not the live editor.
- **Token-only colours:** every new color/shadow goes through `src/styles.css`; no hex literals in components (existing rule).
- **Premium gating** stays route-based (`/verifiable-redaction`) — no flag plumbing needed, `RedactPage` already reads `useRouterState`.

---

## Suggested shipping order

1. Phase 1 (1 turn) — safe, visible everywhere, zero feature risk.
2. Phase 2 (1–2 turns) — biggest perceived quality jump.
3. Phase 3 (1–2 turns) — the "wow" moment + premium justification.
4. Phase 4 (1 turn) — only after the tool itself looks iconic, because the landing demos *it*.

Tell me which phase to start with (or "all of phase 1") and I'll build.
