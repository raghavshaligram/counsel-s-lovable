/**
 * Graceful large-document guard.
 *
 * The redaction/OCR pipeline now scales memory with concurrency (~4 pages
 * at a time), not with page count — but there's still a floor beyond which
 * users are better off splitting the document first. Rather than let the
 * app grind for hours on an impossible input, we warn early and, at the
 * hard ceiling, refuse with a clear "split first" message.
 *
 * These starting limits are conservative. After we stress-test real large
 * inputs we may lower them (especially the OCR limit — a scanned 3000-page
 * doc is far heavier per page than a text-native one).
 */

export const WARN_PAGE_LIMIT = 1500;
export const HARD_PAGE_LIMIT = 5000;

/** Scanned/OCR docs are ~3–4× heavier per page than text-native ones. */
export const WARN_OCR_PAGE_LIMIT = 800;
export const HARD_OCR_PAGE_LIMIT = 2500;

export type GuardLevel = "ok" | "warn" | "block";

export interface LargeDocAssessment {
  level: GuardLevel;
  message?: string;
  pageCount: number;
  ocrPages?: number;
}

export class LargeDocGuardError extends Error {
  readonly assessment: LargeDocAssessment;
  constructor(assessment: LargeDocAssessment) {
    super(assessment.message ?? "Document too large to process safely.");
    this.name = "LargeDocGuardError";
    this.assessment = assessment;
  }
}

export function assessLargeDoc(
  pageCount: number,
  opts?: { ocrPages?: number },
): LargeDocAssessment {
  const ocr = opts?.ocrPages ?? 0;
  const hasOcr = ocr > 0;

  const hardLimit = hasOcr ? HARD_OCR_PAGE_LIMIT : HARD_PAGE_LIMIT;
  const warnLimit = hasOcr ? WARN_OCR_PAGE_LIMIT : WARN_PAGE_LIMIT;

  if (pageCount > hardLimit) {
    return {
      level: "block",
      pageCount,
      ocrPages: ocr,
      message:
        `This document has ${pageCount.toLocaleString()} pages` +
        (hasOcr ? ` (${ocr.toLocaleString()} scanned)` : "") +
        `, above the ${hardLimit.toLocaleString()}-page safe limit for ` +
        `${hasOcr ? "scanned/OCR" : "text"} processing. ` +
        `Split it into smaller documents with Smart Split, then redact each part.`,
    };
  }

  if (pageCount > warnLimit) {
    return {
      level: "warn",
      pageCount,
      ocrPages: ocr,
      message:
        `This is a large ${hasOcr ? "scanned " : ""}document (${pageCount.toLocaleString()} pages). ` +
        `Redaction will run page-by-page and may take several minutes — ` +
        `progress is shown and you can cancel at any time. For faster ` +
        `results, consider splitting the file first.`,
    };
  }

  return { level: "ok", pageCount, ocrPages: ocr };
}
