
# VaultPDF — Complete Build Plan

**Working name:** VaultPDF (final name TBD)
**Tagline:** *The PDF toolkit for documents you'd never upload to the cloud.*
**Target buyer:** AppSumo LTD shopper — solo pros and 2–20 person teams in law, accounting, HR, real estate, healthcare, nonprofits.
**Price target:** $69 Tier 1 / $149 Tier 2 / $299 Tier 3 (team).
**Running cost per user:** $0 (everything runs in the user's browser).

---

## The Moat (one sentence)

Every competitor on AppSumo and every cloud tool (iLovePDF, Smallpdf, Sejda, PDF24, pdf.net, xPDF AI) **must** receive your file on their servers. We **cannot** — the PDF never leaves the browser tab. That's not a privacy *policy*, it's a privacy *architecture*. No SOC2 audit needed because there's nothing to audit. This is structurally impossible for incumbents to copy without rebuilding their entire stack and killing their server-side margins.

Secondary moats:
1. **No file size limits, no page caps, no daily quotas** — incumbents meter because servers cost money; we don't have servers.
2. **Works offline** as an installable PWA — useful in courtrooms, hospitals, airplanes, air-gapped networks.
3. **Bundle no one else has:** Redact + Mail-Merge + Table-Extract in one product. Each exists separately as expensive niche tools; together as an LTD = nowhere.

---

## Feature List (with per-feature moat)

### Tier 1 — The Three Hero Tools (v1 launch)

**1. Smart Redact**
- Auto-detect PII via on-device NER (names, SSNs, DOBs, emails, phones, addresses, account numbers, medical terms)
- One-click "redact all detected" with per-category toggles
- Manual rectangle/text-selection redaction
- **True redaction:** removes content from PDF stream, not a black box overlay (the #1 redaction lawsuit cause)
- Strips metadata (author, revision history, hidden layers) on export
- **Moat:** No AppSumo PDF tool offers redaction at all. Standalone redaction tools (RedactVault, SafeRedact) are server-based and charge subscriptions. AI-based on-device redaction has zero LTD competitors.

**2. Batch Mail-Merge**
- Upload PDF template (existing fillable form or drag-drop fields onto any PDF)
- Upload CSV/XLSX/JSON data file
- Map columns → fields with preview
- Generate 1–10,000 filled PDFs as a zip
- Optional auto-rename files by field value (`{LastName}_{LoanID}.pdf`)
- Optional flatten (lock fields) for sending
- **Moat:** Mortgage/HR/RE professionals' #1 daily pain. Nothing on AppSumo does this. Stirling-PDF issue #2157 (28 upvotes) still open. Closest competitor is per-document SaaS at $30+/mo.

**3. Smart Table Extract**
- Detect tables visually (not just text stream) — handles merged cells, multi-page tables, rotated tables
- OCR fallback for scanned PDFs (Tesseract WASM, 100+ languages)
- Preview detected tables with editable column headers before export
- Export: XLSX / CSV / JSON / Markdown
- Multi-page table stitching with header dedup
- **Moat:** pdftables.io and ExtractFox charge per-page API pricing. No LTD competitor. Accountants will never upload client bank statements to cloud tools — they currently retype.

### Tier 2 — Supporting PDF Utilities (v1 launch, table-stakes)

Bundled because buyers expect a "PDF toolkit" to do these. All client-side, all unlimited:

- Merge / Split (by range, bookmark, or **by keyword** — content-aware splitting; the xPDF AI Q&A gap)
- Compress (mozjpeg + qpdf-wasm)
- Rotate / Reorder / Delete pages
- Convert: PDF↔Image, PDF↔Word, PDF↔Excel (via table extract), Image→PDF
- Password protect / Remove password (if you know it)
- Add watermark / Remove watermark
- E-sign (draw, type, upload) — flattened into PDF
- Fillable form creator (drag-drop fields onto any PDF)
- OCR any scanned PDF to searchable text

### Tier 3 — Premium Differentiators (v1.1, 4–6 weeks post-launch)

- **Semantic Diff:** compare two PDFs at the clause level with plain-English change summary ("Section 4.2 NET-30 → NET-60"). Legal/procurement gold.
- **Document Sanitizer:** one-click strip of all metadata, hidden text, scripts, embedded files, geolocation — compliance teams' wishlist.
- **Folder watcher (desktop PWA):** drop file in watched folder → auto-apply preset (redact + compress + rename).
- **Templates library:** community-shared mail-merge templates (offer letters, NDAs, invoices) — viral loop.

### Tier 4 — Team/Whitelabel (v2, post-LTD)

- Team workspaces (shared templates, shared redaction dictionaries)
- API access (still client-side via npm package) for devs embedding in their own apps
- Whitelabel for accounting/legal SaaS at $299+ tier

---

## Technical Architecture

```text
Browser (everything happens here)
├── React + TanStack Start (existing scaffold)
├── PDF rendering:    PDF.js
├── PDF mutation:     pdf-lib
├── OCR:              Tesseract.js (WASM, lazy-loaded per language)
├── NER (PII detect): Transformers.js + bert-base-NER (~45MB, cached)
├── Table detection:  PyMuPDF via Pyodide (WASM) + heuristics
├── Office conversion: docx → PDF via docx + pdf-lib;
│                     PDF → docx via custom layout reconstruction
├── Zip output:       JSZip + streaming download
└── PWA offline:      Vite PWA plugin + Workbox

Server (Lovable Cloud — minimal)
├── Auth (email + Google) — for license activation only
├── License keys table  — AppSumo code redemption
├── Stripe (post-LTD)   — monthly/annual tier
└── Anonymous usage pings (no file content, ever) — for product analytics
```

**Server does NOT touch user PDFs. Ever.** This is enforced in code AND marketed loudly.

---

## Build Phases

### Phase 0 — Foundation (this session)
- Enable Lovable Cloud (auth + license keys only)
- Strip existing realtor template code
- Landing page with hero, three-tool grid, "your file never leaves your browser" trust section, pricing teaser
- App shell: tool grid → tool workspace pattern
- File drop zone component (reusable across all tools)

### Phase 1 — Hero Tool #1: Smart Redact (week 1)
- PDF viewer (PDF.js)
- Text layer extraction
- Transformers.js NER pipeline, lazy-loaded
- Detection UI with toggles and confidence scores
- Manual selection redaction
- True-redaction export (remove from content stream + strip metadata)
- "Before/after" verification step

### Phase 2 — Hero Tool #2: Mail Merge (week 2)
- CSV/XLSX/JSON parser (papaparse + SheetJS)
- Field detection on PDF + drag-drop field placement on non-form PDFs
- Column → field mapping UI with live preview
- Batch generator with progress + zip stream
- Filename templating

### Phase 3 — Hero Tool #3: Table Extract (week 3)
- Pyodide + PyMuPDF bootstrap (lazy)
- Table detection + visual highlight
- Header editor
- OCR fallback for scanned pages
- XLSX/CSV/JSON export

### Phase 4 — Utility Tools (week 4)
- Merge, split, compress, rotate, convert, watermark, sign, password
- Each ~half a day, shared file-pipeline primitives

### Phase 5 — Polish + AppSumo prep (week 5)
- PWA offline mode
- Onboarding tour
- License key activation flow
- AppSumo listing assets: hero video, screenshots, feature comparison table
- 5-minute demo video showing redact + merge + extract on a fake medical record
- Submit to AppSumo

### Phase 6 — Post-launch differentiators (weeks 6–10)
- Semantic diff
- Document sanitizer
- Templates library
- Folder watcher
- Whitelabel/API tier

---

## Marketing Wedge (so we build for the right hook)

**Hero narrative:** "Smallpdf and iLovePDF want your tax returns, medical records, and legal documents on their servers. We refuse to even build that. VaultPDF processes everything in your browser — we couldn't see your files if we wanted to. Pay once, use forever."

**Comparison table on landing page** (this sells LTDs):

|                        | VaultPDF LTD | Adobe Acrobat | Smallpdf | iLovePDF | UPDF |
|------------------------|:------------:|:-------------:|:--------:|:--------:|:----:|
| Files leave your device|      ❌      |       ✅      |    ✅    |    ✅    |   ❌  |
| AI PII redaction       |      ✅      |    paid add-on|    ❌    |    ❌    |   ❌  |
| Batch mail-merge       |      ✅      |       ❌      |    ❌    |    ❌    |   ❌  |
| Table extract to Excel |    smart     |     basic     |   basic  |   basic  | basic |
| File size limit        |     none     |     none      |   15MB   |   100MB  |  none |
| Works offline          |      ✅      |       ✅      |    ❌    |    ❌    |   ❌  |
| One-time payment       |      ✅      |       ❌      |    ❌    |    ❌    |  *partial* |

---

## Risk + Mitigation

| Risk | Mitigation |
|---|---|
| WASM bundle bloat hurts first load | Lazy-load NER (45MB) and Pyodide only when user opens those tools |
| Browser memory limits on huge PDFs | Stream processing where possible; cap at 500MB with clear UX |
| AppSumo rejection (saturated category) | Pitch "first privacy-architected PDF tool"; the redaction angle is unique |
| Big incumbents copy | They can't without killing server-side billing; client-side cannibalizes their SaaS |
| AI false negatives in redaction | Always require human confirmation step; surface confidence scores; never auto-export |

---

## What I need from you to start

Just "go." I'll enable Lovable Cloud and ship Phase 0 + Phase 1 (working Redact tool with the landing page) in this session.

Optional decisions you can make now or defer:
- **Name:** VaultPDF? RedactPDF? OnPagePDF? PrivatePDF? (I'll default to VaultPDF if you don't pick)
- **Brand tone:** serious/legal-grade vs. friendly/approachable? (defaulting to serious — matches the buyer)
- **Hero color:** trust-blue, lawyer-green, or something more distinctive? (defaulting to deep navy + a single bold accent)
