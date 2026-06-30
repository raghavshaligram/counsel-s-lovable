## Plan: position-based true redaction for custom-font PDFs

1. **Replace string-dependent deletion with geometry-only deletion**
   - Refactor `src/lib/editor/text-rewrite.ts` so redaction does not depend on decoded `Tj`/`TJ` text.
   - Walk each page content stream in operator order and track graphics/text state: `q/Q`, `cm`, `BT/ET`, `Tm`, `Td`, `TD`, `T*`, text leading, font selection `Tf`, font size, character spacing, word spacing, horizontal scale.
   - For every text-show operator (`Tj`, `TJ`, `'`, `"`), compute the rendered text bounding box from current text position, font size, and approximate advance width.
   - If that bounding box intersects any redaction rectangle, remove that text-show operation based only on position.

2. **Add font-width lookup for custom fonts/CMaps**
   - Resolve the active page font resource selected by `Tf` from the copied PDF page resources.
   - Estimate text-show advance using `/Widths`, `/FirstChar`, `/MissingWidth`, `/DW`, and `/W` where available, with a safe default width fallback.
   - Decode string bytes only as glyph/code units for width lookup, not for matching visible text.
   - Preserve surrounding text operators whose bounding boxes do not intersect the redaction rectangles.

3. **Decode and re-encode common PDF stream filter chains**
   - Extend stream handling beyond single `/FlateDecode` to support common chains needed by generated/legal PDFs, especially `ASCII85Decode + FlateDecode` and aliases.
   - Re-encode streams after mutation with a safe supported filter chain so the exported PDF remains readable.
   - Continue skipping unsupported binary/image-only filters rather than corrupting them.

4. **Verify by redaction regions, not strings**
   - Update `src/lib/editor/verify-redaction.ts` to accept redaction rectangles in page coordinates.
   - Re-open the exported PDF with pdf.js, extract text items with transforms/positions, and fail if any text item bounding box intersects a redaction rectangle.
   - Keep string verification as diagnostic metadata only where available, but success must be based on “no text remains inside the redacted regions.”

5. **Wire region verification through export flows**
   - In `src/components/workspace/tool-panels.tsx` and `src/components/workspace/export-dialog.tsx`, pass actual redaction boxes to verification after `exportEditedPdf`.
   - Update success/error wording to report region removal, e.g. all redaction regions cleared.
   - Ensure the Certificate of Redaction only states verified removal when the region-based check passes.

6. **Validation target**
   - Use the existing custom-font test case behavior described by the user: redact all detected items, export, re-extract text with positions, and confirm no text items intersect any redaction rectangle while surrounding text outside rectangles remains extractable.
   - Do not report success unless post-export verification passes with zero text in redaction regions.