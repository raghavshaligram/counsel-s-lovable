/**
 * Fast per-page heuristic classifier: WHY would a page need raster fallback
 * during redaction export?
 *
 * Runs against a live pdf.js document (no re-parse). For each page we peek at
 * the operator list + annotations and bucket the page into ONE dominant
 * reason. Buckets are checked in priority order — a page with both a Form
 * XObject and an annotation appearance counts as "Form XObject" because the
 * Form XObject is the reason redaction can't safely rewrite text ops.
 *
 * NOT a redaction planner — this is diagnostic only. It answers the user's
 * question "why did N pages go through raster fallback?" without needing to
 * actually export.
 */

export type RasterReason =
  | "form-xobject"        // page draws a Form XObject (nested content stream)
  | "annotation-ap"       // annotation with an appearance stream on the page
  | "image-only"          // no text-showing ops at all — scan/image page
  | "type3-font"          // Type3 font in use (custom glyph programs)
  | "text-rewrite-ok";    // page can be handled by text/content-stream surgery

export interface PageReason {
  page: number;             // 1-based
  reason: RasterReason;
}

export interface ClassifyResult {
  totalPages: number;
  rewriteable: number;
  rasterizable: number;
  counts: Record<RasterReason, number>;
  pages: PageReason[];
}

// pdf.js OPS constants we care about (values are stable across builds).
const OPS = {
  setFont: 37,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  paintFormXObjectBegin: 74,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
} as const;

interface PdfLikePage {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getAnnotations(): Promise<Array<{ hasAppearance?: boolean; subtype?: string }>>;
  commonObjs?: { has(id: string): boolean; get(id: string): unknown };
  cleanup?: () => void;
}

interface PdfLikeDoc {
  numPages: number;
  getPage(n: number): Promise<PdfLikePage>;
}

export interface ClassifyOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export async function classifyRasterReasons(
  doc: PdfLikeDoc,
  opts: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const total = doc.numPages;
  const pages: PageReason[] = [];
  const counts: Record<RasterReason, number> = {
    "form-xobject": 0,
    "annotation-ap": 0,
    "image-only": 0,
    "type3-font": 0,
    "text-rewrite-ok": 0,
  };

  for (let i = 1; i <= total; i++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const page = await doc.getPage(i);

    let hasText = false;
    let hasImage = false;
    let hasForm = false;
    let hasType3 = false;

    try {
      const ops = await page.getOperatorList();
      const fnArray = ops.fnArray;
      const argsArray = ops.argsArray;
      for (let k = 0; k < fnArray.length; k++) {
        const fn = fnArray[k];
        if (
          fn === OPS.showText ||
          fn === OPS.showSpacedText ||
          fn === OPS.nextLineShowText ||
          fn === OPS.nextLineSetSpacingShowText
        ) {
          hasText = true;
        } else if (fn === OPS.paintFormXObjectBegin) {
          hasForm = true;
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
          hasImage = true;
        } else if (fn === OPS.setFont && !hasType3 && page.commonObjs) {
          // args = [fontRefId, size]
          const fontId = argsArray[k]?.[0];
          if (typeof fontId === "string") {
            try {
              if (page.commonObjs.has(fontId)) {
                const font = page.commonObjs.get(fontId) as { data?: { type?: string } } | null;
                const type = font?.data?.type;
                if (type === "Type3") hasType3 = true;
              }
            } catch { /* font not resolved yet — ignore */ }
          }
        }
      }

      let hasAnnotAp = false;
      try {
        const annots = await page.getAnnotations();
        hasAnnotAp = annots.some((a) => a.hasAppearance);
      } catch { /* ignore */ }

      let reason: RasterReason;
      if (hasType3) reason = "type3-font";
      else if (hasForm) reason = "form-xobject";
      else if (hasAnnotAp) reason = "annotation-ap";
      else if (hasImage && !hasText) reason = "image-only";
      else reason = "text-rewrite-ok";

      counts[reason]++;
      pages.push({ page: i, reason });
    } finally {
      try { page.cleanup?.(); } catch { /* ignore */ }
    }

    opts.onProgress?.(i, total);
    if ((i & 0x1f) === 0) await new Promise<void>((r) => setTimeout(r, 0));
  }

  const rewriteable = counts["text-rewrite-ok"];
  const rasterizable = total - rewriteable;
  return { totalPages: total, rewriteable, rasterizable, counts, pages };
}

export const REASON_LABELS: Record<RasterReason, string> = {
  "form-xobject": "Form XObject",
  "annotation-ap": "Annotation appearance",
  "image-only": "Image-only (scanned)",
  "type3-font": "Type3 font",
  "text-rewrite-ok": "Text-rewriteable",
};
