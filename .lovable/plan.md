## VaultPDF: Workspace shell → Legal vertical → AppSumo LTD (final)

Two-phase build aligned to a $59 / $129 AppSumo Lifetime Deal launch. Phase 1 turns the disconnected tools into a sticky workspace (Tier 1). Phase 2 layers the Legal Suite paid features (Tier 2). Everything stays client-side; privacy moat preserved end-to-end.

---

### Locked decisions

- **Persistence:** session-only by default. "Keep across sessions (24h)" toggle enables IndexedDB.
- **Storage guard:** 5 files / 150MB cap, LRU eviction with toast *"Optimizing browser memory: clearing oldest file history."*
- **Undo:** last 3 ops per file. Pre-op bytes gzipped **in a dedicated Web Worker** (`compression.worker.ts`) via native `CompressionStream('gzip')` — no main-thread jank on 50MB snapshots. No `fflate` dependency.
- **Vertical:** Legal / paralegal. Bates + verifiable redaction = wedge.
- **Tier 1 activation:** **fully local**, no account. AppSumo code → HMAC-verified against signed allow-list bundled with the app → entitlement token in `localStorage`.
- **Tier 1 revocation:** opt-in 24h online check, **fails open** if offline or check fails. Preserves the offline promise.
- **Tier 2 activation:** same code prompt + Lovable Cloud account (email/password + Google) for cross-device sync. Microsoft SSO deferred.
- **Post-LTD SaaS:** $19 Pro / $49 Team/seat.

---

### Phase 1 — Workspace shell (Tier 1, $59 LTD)

#### 1.1 Workspace core (`src/lib/workspace/`)

- `store.ts` — Zustand store: `files[]` (id, name, Blob, pageCount, thumbnail, ops[]), `activeFileId`, `persistAcrossSessions`.
- `persistence.ts` — `idb-keyval` backed. LRU sweep enforcing 5 files / 150MB. 24h TTL when persistence is on. Boot-time sweep clears expired entries.
- `compression.worker.ts` — Web Worker wrapping native `CompressionStream('gzip')` for snapshot encode/decode. Transferable `ArrayBuffer` postMessage; main thread stays at 60fps.
- `operations.ts` — discriminated union of op entries (`rotate | split | merge | ocr | sign | redact | …`) with pre-op bytes snapshot (worker-gzipped if >1MB), capped at 3 per file.
- `suggestions.ts` — last-op → next-step mapping. Returns free + Pro-locked suggestions for the activity rail upsell surface.

#### 1.2 App shell layout

3-pane shell rendered from `__root.tsx`:

```text
┌─────────────────────────────────────────────────────────┐
│ Top bar: VaultPDF · workspace · persistence toggle · ⚙ │
├──────────┬──────────────────────────────────┬───────────┤
│ Files    │                                  │ Activity  │
│ rail     │   Tool canvas (current route)    │ rail +    │
│ (shadcn  │                                  │ next-step │
│ Sidebar) │                                  │ suggest   │
└──────────┴──────────────────────────────────┴───────────┘
```

- **Left:** shadcn `Sidebar collapsible="icon"`, page-1 thumbnails, drag-to-reorder, "+ Add file".
- **Right:** operation history + "Undo last step" + "Next step" suggestion cards.
- **Center:** existing route components, refactored to read/write the active file from the store.

#### 1.3 Per-tool refactor (all 17 routes)

`split`, `rotate`, `merge`, `compress`, `ocr`, `sign`, `watermark`, `unlock`, `protect`, `redact`, `extract`, `to-images`, `images-to-pdf`, `to-word`, `word-to-pdf`, `compare`, `editor`, `chat`:

- Drop local `useState<File | null>`; read `useActiveFile()`.
- Output writes back as in-place replacement or sibling file. Toggle: "Replace" vs "Add to workspace" (default Add).
- Download button stays. New "Use in another tool →" dropdown pre-loads result into the next tool.
- Multi-file tools (Merge, Compare, Batch OCR) gain a "Select from workspace" picker.

#### 1.4 Landing + nav

- Hero CTA: "Open workspace".
- Top nav exposes all 17 tools grouped (Organize, Convert, Secure, AI).
- New `/tools` SEO index page.

#### 1.5 Onboarding

3-step pointer tour ("Drop a file → Pick a tool → Chain from the right rail"). Skippable. localStorage flag.

#### 1.6 Tier 1 license activation (`src/lib/license/`)

- `activation.ts` — code prompt UI. Validates against `signed-codes.ts` bundle (HMAC-SHA256 list of code hashes signed with a build-time key; rotated per AppSumo batch). Stores `{ tier: 1, code, activatedAt }` in `localStorage`.
- `revocation.ts` — opt-in 24h fetch to `/api/public/license-status` returning a deny-list delta. **Fails open** on network error or offline. Only fires when navigator is online.
- Workspace runs at full Tier 1 features the instant the code is verified — no email, no account, no redirect.

---

### Phase 2 — Legal Suite (Tier 2, $129 LTD)

#### 2.1 Bates numbering (hero feature)

- Batch input: folder drop or workspace multi-select.
- Config: prefix, start number, zero-padding width, position, font + size.
- OffscreenCanvas + Worker pool. **Sub-3s benchmark for 10 PDFs** on commodity hardware before ship.
- Outputs renumbered set + Bates index CSV.

#### 2.2 Verifiable redaction + Certificate PDF

Upgrade `redact.tsx`:

- **True text removal** — re-emit content stream with redacted glyphs stripped (not visual cover).
- **JSON audit log** — every redaction (page, coords, pattern type, timestamp, optional redactor).
- **Certificate of Redaction PDF** — generated locally via `pdf-lib` in `src/lib/legal/redaction-certificate.ts`. Input: `RedactionSummary { documentName, preHash, postHash, patternCounts, timestamp, redactor? }`. Output: branded single-page PDF with:
  - VaultPDF header + logo
  - Document name + SHA-256 pre/post hashes (computed via `crypto.subtle.digest`)
  - Pattern-count table ("14 Social Security Numbers permanently removed")
  - Timestamp + optional redactor signature line
  - Footer: *"Generated locally in browser — no data transmitted"*
- Pre-share "Redaction preview" mode highlights every redacted region.
- Cert downloads as sibling file alongside sanitized PDF.

#### 2.3 PII / privilege indicator

Builds on `src/lib/pdf/detect-pii.ts`. Detects SSN, account numbers, "attorney-client", "work product", "privileged & confidential", custom keywords. Sidebar badge with count + click-to-jump. Pre-share modal warning.

#### 2.4 Upsell suggestion cards

Activity rail "Next step" panel renders Pro features inline with lock icon + Unlock CTA:

- After **Redact** → "Generate Compliance Certificate (Pro)"
- After **OCR** on 3+ files → "Batch OCR queue (Pro)"
- After **Sign** → "Add Bates numbering (Pro)"
- After **Extract** on a contract → "Scan for privileged terms (Pro)"

Click → AppSumo upgrade modal (during LTD) or Stripe checkout (post-LTD).

#### 2.5 `/for/legal` landing page

- Hero: "PDFs that never leave your firm."
- Bates demo video (10 PDFs stamped <3s).
- Redaction Certificate sample download.
- Comparison vs Acrobat Pro / Smallpdf.
- SEO targets: *redact pdf privilege*, *bates number pdf online*, *private pdf tools law firm*.

---

### AppSumo LTD pricing

| Tier | Price | Includes |
|------|-------|----------|
| Tier 1 | **$59 LTD** | All of Phase 1: 17 tools + workspace shell + 24h persistence + multi-file workspace. **Local code activation, no account required.** Lifetime. |
| Tier 2 | **$129 LTD** | Tier 1 + Legal Suite (Bates batch, verifiable redaction + Certificate PDF, PII indicator) + unlimited workspace size + priority requests. **Account required for cross-device sync.** |
| Stack | each extra Tier 2 code | +1 seat. |

Post-LTD: $19 Pro / $49 Team/seat.

---

### Sequencing

- **Milestone A — Workspace core + proof-of-concept tool** (~1 week)
  - `workspace/store.ts`, `persistence.ts`, `compression.worker.ts`, `operations.ts`, `suggestions.ts`
  - 3-pane shell in `__root.tsx`
  - Refactor **Rotate** as the pattern proof
- **Milestone B — Roll the pattern across all tools** (~4-5 days)
  - Split → Merge → OCR → Sign → remaining 12 tools
  - Landing + nav + `/tools` index + onboarding tour
- **Milestone C — Legal Suite** (~1 week)
  - Bates batch (with sub-3s/10-files benchmark gate)
  - True redaction + Certificate PDF generator
  - PII / privilege indicator
  - Pro-locked suggestion cards
- **Milestone D — Monetization** (~3-5 days)
  - Tier 1 local activation (`license/activation.ts`, signed code bundle, 24h fails-open revocation check at `/api/public/license-status`)
  - Tier 2: Lovable Cloud auth (email + Google) + `subscriptions` + `appsumo_codes` tables (RLS)
  - AppSumo webhook `/api/public/appsumo-webhook` for Tier 2 code provisioning
  - Stripe webhook `/api/public/stripe-webhook` for post-LTD
  - `/for/legal` landing + `/pricing` LTD tiers

---

### Technical notes

- **State:** Zustand single store; tools = controlled views.
- **Persistence:** `idb-keyval` + LRU + TTL sweep.
- **Compression:** native `CompressionStream('gzip')` inside a dedicated Web Worker, transferable buffers, no `fflate`.
- **Routing:** file-based; shell at root via `<Outlet />`.
- **No backend for Phase 1.** Phase 2 enables Lovable Cloud + minimal tables, RLS-locked, all writes via signed webhooks.
- **Bates perf:** OffscreenCanvas + Worker pool, benchmark gate before ship.
- **Redaction integrity:** SHA-256 via `crypto.subtle.digest` on raw bytes pre/post; embedded in Certificate PDF.
- **License signing:** HMAC-SHA256 over code hashes with a build-time `LICENSE_SIGNING_KEY`; verifier ships in the bundle, key does not.

Ready to switch to build mode and start Milestone A on your "go".
