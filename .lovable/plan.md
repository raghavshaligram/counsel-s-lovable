# PDF Toolkit — Revised Roadmap (v2)

100% client-side. No AI, no Workspace, no server-dependent tools. **Every new route ships with a hand-crafted designed surface** — not a dropzone-and-sidebar template. Before each designed route I'll generate 3 visual directions via `create_directions` and you pick.

---

## Locked technical adjustments (from your feedback)

1. **Tray store holds metadata only.** Zustand state = `{ id, sha256, name, size, pageCount, addedAt, thumb? }`. Bytes live in IndexedDB (`idb-keyval`, keyed by SHA-256, deduped). The Batch Runner streams bytes back in *just before* each op runs and drops them as soon as the op resolves. This keeps the tab under memory pressure even with 10+ large files queued.
2. **Batch Runner is a bounded worker pool.** Pool size = `min(navigator.hardwareConcurrency - 1, 4)` capped by `resources.workerPoolSize` (re-uses `src/lib/workers/resources.ts` tiering — conservative tier drops to 2). Pure tool fn `op(bytes, opts) → bytes` runs in a Worker. Outputs collected, then zipped via `fflate` once the queue drains. Single failure does not abort the batch; per-file status surfaced in UI.
3. **PDF/A font subsetting via `@pdf-lib/fontkit`.** Scan text layer → build glyph set per font → embed subset (not full file). Applied to every Standard14 substitution and any custom embedded font. Keeps `/pdf-a` output compliant *and* small.

---

## Design bar (every new route)

- Custom working surface chosen for the task (page-grid canvas, split tree+viewer, field-paint mode, ruler-overlaid artboard, before/after diff, etc.).
- Tokens from `src/styles.css` only — no hardcoded colors.
- Designed empty state (shows what the tool produces), not "Drop PDF here".
- Inspector panels float; nothing crowds the document.
- Framer Motion, 200ms ease-out, no bounce. Real keyboard model per tool.

Existing tools (Bates, Redact, Compress, etc.) are NOT redesigned in this roadmap.

---

## Phase 1 — Multi-file foundation

1. **Persistent File Tray** — bottom strip, chips per loaded PDF (name, pages, size, remove).
   - State: `src/lib/tray/store.ts` (Zustand) — **metadata only**.
   - Bytes: `src/lib/tray/blobs.ts` (`idb-keyval`, SHA-256 keyed, dedup, LRU eviction at `cacheBudgetMB`).
   - Lazy-load: `await getBytes(id)` only when a tool or batch op needs them.
   - *Designed: tray as a typographic ledger, not browser tabs.*
2. **Batch Runner** — `src/lib/batch/runner.ts`.
   - Worker pool sized from `detectResources()` (cap 4).
   - Each tool exports `op(bytes, opts) → bytes` in `src/lib/workers/ops/*.worker.ts`.
   - Per-file progress, fail isolation, **ZIP output via `fflate`** when queue drains.
   - *Designed: single composed progress timeline.*
3. **Wire batch into existing tools**: Compress, Watermark, Protect, Rotate, Bates get "Apply to all in tray". Minimal UI toggle, no new design pass.
4. **`/organize` — cross-doc page grid** *(designed route)*. Thumbnails from every tray PDF in one drag-grid. Drag between docs, reorder, delete, group into new PDF. `/merge` stays for the simple flow.
5. **Recent files** — IndexedDB, reopen without re-upload. Surfaced as a designed module on landing.

## Phase 2 — Five designed structural tools

- **`/pdf-a`** — PDF/A-2b/3b export. **Font subsetting via `@pdf-lib/fontkit`** (glyphs-used only), RGB→sRGB ICC, strip JS/embedded files, flatten forms, XMP + OutputIntent. *Design: post-export compliance report card.*
- **`/forms`** — Minimal v1: drag-to-create Text/Checkbox/Radio/Dropdown/Signature, per-field name/required/default/tab order. Real AcroForms in export. No JS validation. *Design: field-paint mode, numbered tab-order overlay.*
- **`/crop`** — Visual crop handles. MediaBox/CropBox/TrimBox/BleedBox independently. Presets A4/Letter/Legal/A3/custom. *Design: rulers + dimension callouts, InDesign-style artboard.*
- **`/optimize`** — Presets (Screen/eBook/Print/Prepress) + granular toggles (thumbnails, unused objects, image DPI, JPEG quality, font subset, drop bookmarks, strip metadata/annotations). **No linearization** (needs qpdf). *Design: before/after diff with per-category savings chart.*
- **`/outline`** — Editable bookmark tree (add/rename/nest/reorder, jump to Page+XY). Rectangle tool for link annotations (URL or GoTo). "Linkify all URLs" one-click. *Design: tree left, viewer center, link inspector right. Keyboard-driven.*

## Phase 2.5 — Small wins (4 tools)

- **`/to-excel`** — Wire existing `extract-tables.ts` (heuristic + OCR fallback, xlsx export). Per-page preview, edit cells before export.
- **`/flatten`** — Form fields + annotations baked into static page content. Toggle per category.
- **`/header-footer`** — Per-doc header & footer with tokens (`{page}`, `{pages}`, `{date}`, `{filename}`), font/size/margin/alignment, even/odd/first-page rules. Separate from Bates.
- **`/page-numbers`** — Position (6 corners + center), format (`1`, `Page 1`, `1 of N`, roman), start number, skip first N, font choice.

All four batch-enabled via the Phase 1 runner.

## Phase 3 — Polish

- **Tamper-evident signing wired in.** `src/lib/trust/export.ts` already exists. Add "Sign export" toggle to every tool's export panel; produces sidecar `<name>.certificate.json` (Ed25519 + SHA-256).
- **Strict CSP headers.** Apply via TanStack Start response middleware. Tighten `connect-src` to self only (no AI providers anymore). `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`.
- **Free/paid gates.** Free: 3 files/batch, 25 MB/file, no batch on Compress/Optimize/PDF-A. Paid: unlimited, batch on all, ZIP export, signing, PDF/A.
- **Drag-anywhere dropzone** on every tool page. Encrypted-PDF auto-suggest → `/unlock`.

---

## Permanently dropped (need server, not feasible 100% client-side)

PDF→PowerPoint · Repair · HTML→PDF / URL→PDF · Booklet imposition · Linearization / Fast Web View · AcroForm JS validation / calculations · PDF/A-1a / 2a / 3a · **PWA install prompt** (per your call).

---

## Technical notes

- Tray store: metadata in Zustand, bytes in `idb-keyval` keyed by SHA-256, LRU evict at `cacheBudgetMB`.
- Batch runner: bounded Worker pool, ZIP via `fflate`, per-file status.
- All tools built on `pdf-lib`. PDF/A font subset via `@pdf-lib/fontkit`. Image downsample via canvas. xlsx via existing `xlsx` dep.
- New routes (TanStack file-based): `/organize`, `/pdf-a`, `/forms`, `/crop`, `/optimize`, `/outline`, `/to-excel`, `/flatten`, `/header-footer`, `/page-numbers`. Each with full SEO `head()` + JSON-LD.
- App-shell nav: Organize / Convert / Edit / Secure / **Structure** (PDF/A, Forms, Crop, Optimize, Outline, Flatten) / Legal (Bates, Redact, Header/Footer, Page numbers).
- CSP: response header in TanStack Start server entry. Signing: shared `<ExportPanel/>` primitive used by every tool.

## Build order

1. Tray store (metadata + lazy bytes) + Batch Runner (worker pool + fflate ZIP) + wire existing tools
2. `/organize` *(first designed route — pick direction)*
3. `/outline`
4. `/crop`
5. `/optimize`
6. `/pdf-a` (with fontkit subsetting)
7. `/forms`
8. **Phase 2.5 burst:** `/to-excel`, `/flatten`, `/header-footer`, `/page-numbers`
9. Signing everywhere + strict CSP + paywall gates + recent files
