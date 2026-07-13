## Conformance level check — clear to fix

Every PDF/A reference in the codebase targets **PDF/A-2b**. No PDF/A-1b claim exists anywhere.

### Evidence

| Location | Claim |
|---|---|
| `src/lib/pdf/to-pdfa.ts:110–111` | XMP writes `pdfaid:part=2` + `pdfaid:conformance=B` |
| `src/lib/pdf/to-pdfa.ts:543, 568` | Producer string `"CounselPDF (PDF/A-2b)"` |
| `src/lib/pdf/to-pdfa.ts:564` | Step name `"write XMP metadata (pdfaid part=2 conformance=B)"` |
| `src/lib/pdf/to-pdfa.ts:5, 626` | Header comment + structural verifier: "ISO 19005-2 / PDF/A-2b" |
| `src/lib/pdf/download.ts:3–5, 59` | Comments + user toast: "PDF/A-2b saved" |
| `src/components/workspace/export-format-row.tsx:3, 63, 125` | User-facing label "PDF/A-2b" in the export format picker |
| `src/components/workspace/workflow-builder-panel.tsx:266–268` | Automation step "Convert to PDF/A-2b" |
| `src/lib/automation/registry.ts:74, 85` | Automation description + error message "PDF/A-2b" |
| `src/lib/pdf/embed-standard14.ts:4` | Font embedder comment: "PDF/A-2" |
| `src/lib/pdf/fonts-pdfa.ts` | Font module scoped to PDF/A-2 rules |

Zero occurrences of `"PDF/A-1"`, `pdfaid:part=1`, or `conformance=A`.

### Implication

PDF/A-2b (ISO 19005-2) explicitly **allows** cross-reference streams and object streams — only PDF/A-1b (ISO 19005-1, based on PDF 1.4) forbids them. Flipping `useObjectStreams: false → true` at `src/lib/pdf/to-pdfa.ts:591` stays fully conformant with the level the app already claims, verifies, and ships in its UI.

### Revised plan

1. **`src/lib/pdf/to-pdfa.ts:591`** — change `useObjectStreams: false` to `useObjectStreams: true`. Add a one-line comment: `// PDF/A-2b (ISO 19005-2) permits object streams; PDF/A-1b did not — do not flip back without also downgrading the pdfaid:part in the XMP.`
2. **`src/lib/test/redaction-e2e-harness.ts:114, 271`** — flip both to `true` for consistency (test-only, no shipped impact, but prevents the pattern from being copied back into a production path).
3. **Do not touch** `compress.ts`, `export.ts` (already `true`), the gate, burn correctness, or the structural verifier — the verifier keys off XMP + OutputIntent + trailer /ID, none of which are affected by the object-stream flag.
4. **Verify after the change** by running one PDF/A export end-to-end: the `[pdfa] self-check` in `to-pdfa.ts:601` must still pass (it will — object streams don't touch any checked marker) and file size on the 3000-page redacted doc should collapse from 747MB back toward the ~18MB export baseline plus a small PDF/A overhead.

No diagnostic logging pass needed anymore — the conformance audit + the earlier grep together already localize the bloat to this single line.