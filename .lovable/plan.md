## PDFMacro Rebrand — Implementation Plan

### 1. Brand mark (v1 — PM Monogram)
- Generate `public/favicon.png` (512×512, transparent) — bold "PM" ligature with folded page corner, steel blue (#4C7FB8) on transparent.
- Generate `src/assets/pdfmacro-logo.png` (transparent) for in-app header use.
- Delete template default `public/favicon.ico`.
- Wire favicon in `src/routes/__root.tsx` `head().links`.

### 2. Text sweep — replace all `CounselPDF` and `VaultPDF` with `PDFMacro`
Scope: `src/**`, `public/**`, `tests/**`, `index.html`, `README.md`, `package.json` name field.
Includes user-visible strings, comments, code identifiers in component names/strings, JSDoc.

### 3. SEO / head metadata
- `src/routes/__root.tsx`: title, description, og:site_name → PDFMacro; JSON-LD Organization name + url `https://pdfmacro.com`.
- Leaf routes: update title/description/og:title/og:description/og:url/canonical to `pdfmacro.com`.
- Update any hardcoded prior domain references.

### 4. PWA manifest
- `public/manifest.webmanifest`: `name`, `short_name`, `description`, `theme_color`, icons → new favicon.

### 5. Service Worker cache
- Bump cache version to `pdfmacro-v1-offline` so old caches evict on next load.

### 6. Storage keys — rename, no migration
Rename every persisted key (no migration = users lose local state, per your call):
- IndexedDB database names: `vaultpdf-*` / `counselpdf-*` → `pdfmacro-*` (workspace, sidecars, recents).
- localStorage keys: any `vaultpdf.*` / `counselpdf.*` prefix → `pdfmacro.*` (toolbar pin, nav overlay geometry, resume prefs, column selections, etc.).
- Sidecar schema `app` field if stamped.

### 7. Verification
- `rg -i 'counselpdf|vaultpdf'` returns zero hits.
- Typecheck clean.
- Browser check: favicon renders, title bar shows "PDFMacro", app loads fresh (empty state expected — no migration).

### Notes
- Storage reset means every existing user sees an empty workspace on first load after deploy. Documents on disk are unaffected; only persisted app state (recents, sidecars, preferences) is dropped.
- OG social previews on already-shared links refresh only when the platform re-scrapes.
