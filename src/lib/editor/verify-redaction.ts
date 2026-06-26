/**
 * Verify that destructive redaction actually removed text.
 *
 * Given the exported PDF bytes and the list of strings that were marked for
 * redaction (captured at redact-time as `RedactAnno.sources[].originalString`),
 * re-parse the exported file with pdf.js and confirm none of those strings
 * appear in the text layer of the page they were redacted on.
 *
 * A "leak" means the visual overlay covered the glyphs but the underlying
 * text is still extractable — search/copy/screen-reader will recover it.
 * For PDFs with custom CMaps the literal Tj operand can't be matched against
 * the user-visible string; in those cases destructive rewrite is skipped and
 * verification will flag the leak honestly rather than lying about success.
 */
import { loadPdfjs } from "@/lib/pdf/worker";

export interface RedactionTarget {
  /** 0-indexed page in the exported PDF. */
  page: number;
  /** Original string captured at redact time. */
  text: string;
  /** Optional label (e.g. exemption code) for reporting. */
  label?: string;
}

export interface VerifyResult {
  ok: boolean;
  total: number;
  removed: number;
  leaks: Array<{ page: number; text: string; label?: string }>;
  scannedAt: string;
}

export async function verifyRedactionRemoval(
  bytes: Uint8Array,
  targets: RedactionTarget[],
): Promise<VerifyResult> {
  const scannedAt = new Date().toISOString();
  if (targets.length === 0) {
    return { ok: true, total: 0, removed: 0, leaks: [], scannedAt };
  }

  const pdfjs = await loadPdfjs();
  // Fresh parse: this is the EXPORTED file, not the open document, so the
  // workspace's cached pdfDoc doesn't apply here. Worker handles parsing.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  // Bucket targets by page so we only extract each page once.
  const byPage = new Map<number, RedactionTarget[]>();
  for (const t of targets) {
    const arr = byPage.get(t.page) ?? [];
    arr.push(t);
    byPage.set(t.page, arr);
  }

  const leaks: VerifyResult["leaks"] = [];
  try {
    for (const [pageIdx, items] of byPage) {
      if (pageIdx < 0 || pageIdx >= doc.numPages) continue;
      const page = await doc.getPage(pageIdx + 1);
      const tc = await page.getTextContent();
      // Join all text fragments. We deliberately don't normalize whitespace
      // aggressively — if the redacted phrase survives as broken-up runs
      // that's still a leak we want to surface.
      const pageText = tc.items
        .map((it) => ("str" in it ? (it as { str: string }).str : ""))
        .join(" ");
      for (const t of items) {
        if (!t.text) continue;
        if (pageText.includes(t.text)) {
          leaks.push({ page: pageIdx, text: t.text, label: t.label });
        }
      }
      page.cleanup();
    }
  } finally {
    try { await doc.destroy(); } catch { /* ignore */ }
  }

  const removed = targets.length - leaks.length;
  return {
    ok: leaks.length === 0,
    total: targets.length,
    removed,
    leaks,
    scannedAt,
  };
}
