# Changelog — legal-critical modules

This file tracks every intentional change to the modules that guarantee
true-deletion redaction, PII detection, metadata sanitization, Bates
continuity, and exhibit-binder mapping. **Do not modify these modules
without a corresponding entry here and a passing test run.**

Tracked modules:

- `src/lib/editor/text-rewrite.ts` — content-stream rewriter that deletes
  glyphs underneath each redaction rectangle.
- `src/lib/editor/rasterize-redacted-pages.ts` — pixel-burn fallback for
  scanned / image-only pages.
- `src/lib/editor/verify-redaction.ts` — post-export text-layer verifier.
  Runtime safety gate: blocks the download if any redacted region still
  yields extractable text.
- `src/lib/editor/verify-pixel-redaction.ts` — post-export OCR verifier
  for rasterized pages.
- `src/lib/pdf/sanitize.ts` — strips document metadata / XMP / embedded
  files / JavaScript before sharing.
- `src/lib/pdf/detect-pii.ts` — structured-data detection (SSN, card,
  email, phone, IBAN, IP) + NER-assisted name/org suggestions.
- `src/lib/pdf/ner.ts` — on-device PERSON / ORG entity recognition.
- `src/lib/batch/ops/bates.ts` — sequential Bates stamping.
- `src/lib/batch/ops/exhibit-binder.ts` — exhibit labelling + ToC mapping.

Regression tests live in `tests/` and run via `bun run test`.

## v1.0.0 — 2026-06-29

Initial changelog + regression-test baseline.

- Added `tests/sanitize.test.ts` — metadata is stripped end-to-end and
  sensitive values placed in Title/Author/Subject/Keywords do not survive.
- Added `tests/detect-patterns.test.ts` — structured-PII regex contract
  for SSN, email, phone, credit card, IBAN, IP, date.
- Added `tests/bates.test.ts` — `formatBates` continuity + `addBates`
  roundtrip preserves page count.
- Added `tests/exhibit-binder.test.ts` — `exhibitLabel` letter/number
  sequencing (A..Z → AA..AZ) and `cleanExhibitTitle` filename cleanup.
- Exported `PATTERNS` from `detect-pii.ts` for direct regex testing.
  This is the only structural change to a tracked module in this entry.

Runtime safety gate (defense in depth) remains in
`src/components/workspace/export-dialog.tsx` and `src/routes/editor.tsx`:
`verifyRedactionRemoval` runs on every export and `throw`s before
`downloadPdf` if any redacted region still contains extractable text.
This gate must never be removed or downgraded to a warning.
