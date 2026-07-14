# Enable XFA PDF support

## Problem

XFA-only PDFs (common with government / bank / court forms authored in LiveCycle Designer) ship a single "static fallback" page whose contents read *"Please wait… if this message is not eventually replaced, your PDF viewer may not support XFA forms. Please open in Adobe Acrobat Reader."* That's what the user is seeing — the PDF itself is telling them to use Acrobat, because our pdf.js instance is opening the fallback page instead of the XFA form.

pdf.js has built-in XFA rendering; it's just off by default. Turning it on makes these forms render as real pages we can view, extract, redact, and export like any other PDF.

## Change

Pass `enableXfa: true` (and `useSystemFonts: true` where safe) to every `pdfjs.getDocument({...})` call so XFA content is rendered instead of the fallback page.

Central helper:

- Add `src/lib/pdf/open-doc.ts` exporting `openPdfDoc(src, opts?)` that wraps `pdfjs.getDocument({ data, enableXfa: true, useSystemFonts: true, ...opts }).promise`.
- Migrate all ~20 `pdfjs.getDocument({ data: ... })` call sites (list from grep: `redact-page.tsx`, `workspace-shell.tsx` ×2, `tool-panels.tsx`, `print.ts`, `to-word.tsx`, `sign.tsx`, `security-architecture.tsx` (code sample only — skip), `privilege-scan.tsx`, `outline.tsx`, `organize.tsx`, `ocr.tsx`, `automation/conditions.ts`, `verify-redaction.ts`, `editor-canvas.tsx`, `privilege-review-panel.tsx`, `rasterize-redacted-pages.ts`, `editor.tsx` ×2, `crop.tsx`, plus the compare + chat/pdf-extract paths) to the helper.
- Leave `src/routes/security-architecture.tsx` alone — that occurrence is a code sample rendered as text.

## Caveats to surface in the plan (not blockers)

1. **Editing/redaction of XFA fields**: pdf.js renders XFA to a DOM/canvas layer, but the underlying PDF still stores form data in the XFA XML packet, not AcroForm widgets. Our editor/redact/flatten already operates on the rasterized page + text layer, so viewing, searching, extracting, redacting, exporting all work. Round-tripping *edited XFA field values* back into the XFA packet is out of scope — very few tools outside Acrobat do that.
2. **Export/flatten**: when we rebuild via pdf-lib, XFA packets are preserved as-is; the visible output uses our page rebuild path, so the "please use Acrobat" fallback page will no longer be what's exported.
3. **Perf**: `enableXfa` only activates for PDFs that actually contain an XFA packet — zero cost for normal PDFs.

## Verification

- Open the user's XFA form → real form pages render (not the fallback message).
- Open a regular PDF → unchanged.
- Run redact + export on both.
