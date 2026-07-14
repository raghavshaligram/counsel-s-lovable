/**
 * Citation Hyperlinker — annotation writer.
 *
 * Appends URI /Link annotations to an existing PDF using pdf-lib. NEVER
 * draws any filled rectangle over citation text — the visible affordance
 * is a thin blue UNDERLINE only, drawn just below the citation rect.
 *
 * IMPORTANT SAFETY INVARIANT
 * --------------------------
 * The link path MUST NOT share a "draw filled rectangle" primitive with
 * redaction. A filled rectangle over live text — regardless of blend mode
 * — reads as an opaque box in viewers that ignore or misinterpret the
 * blend, which silently obscures the citation (a "reverse redaction" bug
 * class the redaction verification gate does not cover, because that gate
 * only asserts that redacted content is GONE, not that non-redacted
 * content is still VISIBLE).
 *
 * Rules enforced below:
 *   1. Only `page.drawLine` is used for visible styling. No `drawRectangle`,
 *      no fill, no blend modes, no opacity tricks.
 *   2. The underline is drawn OUTSIDE the citation rect (a few tenths of a
 *      point below `lly`), so even the underline cannot touch glyphs.
 *   3. Callers can (and should) run `verifyCitationsLegible` on the output
 *      to assert the citation regions still contain rendered content.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  rgb,
  type PDFContext,
} from "pdf-lib";

import { loadPdfjs } from "@/lib/pdf/worker";

/**
 * Two options in the UI, both underline-only. `underline-blue-text` used
 * to overlay a tinted rectangle to recolor glyphs; that path caused the
 * "opaque box over citation" defect and has been removed. It is retained
 * here as an accepted value only so callers don't break; both render as a
 * blue underline.
 */
export type CitationLinkStyle = "underline" | "underline-blue-text";

export interface CitationLinkInput {
  page: number;
  rect: [number, number, number, number];
  url: string;
  /** Human-readable citation text — stored as /Contents for accessibility. */
  text?: string;
}

/** Legal-brief link blue — matches Word / Bluebook default hyperlink hue. */
const LINK_BLUE = rgb(6 / 255, 69 / 255, 173 / 255); // #0645AD

function buildLinkAnnot(
  ctx: PDFContext,
  input: CitationLinkInput,
): PDFRef {
  const annot = ctx.obj({}) as PDFDict;
  annot.set(PDFName.of("Type"), PDFName.of("Annot"));
  annot.set(PDFName.of("Subtype"), PDFName.of("Link"));
  annot.set(
    PDFName.of("Rect"),
    ctx.obj(input.rect.map((n) => PDFNumber.of(n))),
  );
  annot.set(
    PDFName.of("Border"),
    ctx.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)]),
  );
  annot.set(PDFName.of("H"), PDFName.of("I"));
  if (input.text) {
    annot.set(PDFName.of("Contents"), PDFString.of(input.text));
  }
  const action = ctx.obj({}) as PDFDict;
  action.set(PDFName.of("Type"), PDFName.of("Action"));
  action.set(PDFName.of("S"), PDFName.of("URI"));
  action.set(PDFName.of("URI"), PDFString.of(input.url));
  annot.set(PDFName.of("A"), action);
  return ctx.register(annot);
}

/**
 * Load `sourceBytes`, append URI link annotations plus a thin blue
 * underline below each citation. Non-destructive to existing annotations
 * and never draws over the citation glyphs.
 */
export async function applyCitationLinks(
  sourceBytes: Uint8Array,
  links: CitationLinkInput[],
  // Style parameter is accepted for API compatibility; both values render
  // as an underline-only affordance. See the file header for why any
  // rectangle fill was removed from this path.
  _style: CitationLinkStyle = "underline",
): Promise<Uint8Array> {
  void _style;
  const doc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const pages = doc.getPages();

  const byPage = new Map<number, CitationLinkInput[]>();
  for (const l of links) {
    if (l.page < 0 || l.page >= pages.length) continue;
    const arr = byPage.get(l.page) ?? [];
    arr.push(l);
    byPage.set(l.page, arr);
  }

  for (const [pageIdx, pageLinks] of byPage.entries()) {
    const page = pages[pageIdx];

    for (const l of pageLinks) {
      const [llx, lly, urx, ury] = l.rect;
      const width = Math.max(0, urx - llx);
      const height = Math.max(0, ury - lly);
      if (width <= 0 || height <= 0) continue;

      // Thin underline BELOW the rect. Never inside the glyph band, never
      // a fill. Thickness scales with font height but is clamped small.
      const thickness = Math.max(0.5, Math.min(1.0, height * 0.05));
      const underlineY = lly - Math.max(0.4, height * 0.05);
      page.drawLine({
        start: { x: llx, y: underlineY },
        end: { x: urx, y: underlineY },
        thickness,
        color: LINK_BLUE,
      });
    }

    const refs = pageLinks.map((l) => buildLinkAnnot(ctx, l));
    const existing = page.node.get(PDFName.of("Annots"));
    if (existing instanceof PDFArray) {
      for (const r of refs) existing.push(r);
    } else {
      page.node.set(PDFName.of("Annots"), ctx.obj(refs));
    }
  }

  return doc.save();
}

/* ------------------------------------------------------------------ */
/*  Safety gate: verify citation regions are still legible after link  */
/* ------------------------------------------------------------------ */

export interface LegibilityFailure {
  page: number;
  rect: [number, number, number, number];
  text?: string;
  reason: string;
}

/**
 * Render each citation region from the LINKED PDF and confirm the region
 * still contains meaningful content (i.e., the citation text was not
 * accidentally covered by an opaque box). This is the inverse of the
 * redaction gate — that gate asserts absence of secrets; this asserts
 * PRESENCE of the citation.
 *
 * Heuristic: for each rect, sample pixels at ~150 DPI and require both
 * (a) sufficient dark-pixel ratio (text-shaped ink present) and
 * (b) sufficient luminance variance (not a flat opaque block of any color).
 *
 * Cheap enough to run inline after apply; skips entirely for zero links.
 */
export async function verifyCitationsLegible(
  pdfBytes: Uint8Array,
  links: CitationLinkInput[],
): Promise<LegibilityFailure[]> {
  if (links.length === 0) return [];
  const pdfjs = await loadPdfjs();
  const failures: LegibilityFailure[] = [];

  const byPage = new Map<number, CitationLinkInput[]>();
  for (const l of links) {
    const arr = byPage.get(l.page) ?? [];
    arr.push(l);
    byPage.set(l.page, arr);
  }

  const loadingTask = pdfjs.getDocument({ data: pdfBytes.slice(0), enableXfa: true, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  try {
    const scale = 150 / 72;
    for (const [pageIdx, pageLinks] of byPage.entries()) {
      if (pageIdx < 0 || pageIdx >= pdf.numPages) continue;
      const page = await pdf.getPage(pageIdx + 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const canvasCtx = canvas.getContext("2d", { willReadFrequently: true });
      if (!canvasCtx) continue;
      // White background so a pure white rect (no glyphs) is detectable.
      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: canvasCtx,
        viewport,
        canvas,
      } as unknown as Parameters<typeof page.render>[0]).promise;

      const pageHeight = viewport.height;
      for (const l of pageLinks) {
        const [llx, lly, urx, ury] = l.rect;
        // PDF user-space → canvas pixel space (y flipped).
        const x0 = Math.max(0, Math.floor(llx * scale));
        const x1 = Math.min(canvas.width, Math.ceil(urx * scale));
        const y0 = Math.max(0, Math.floor(pageHeight - ury * scale));
        const y1 = Math.min(canvas.height, Math.ceil(pageHeight - lly * scale));
        const w = x1 - x0;
        const h = y1 - y0;
        if (w <= 1 || h <= 1) continue;

        const { data } = canvasCtx.getImageData(x0, y0, w, h);
        let dark = 0;
        let sum = 0;
        let sumSq = 0;
        const px = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          // Perceptual luma
          const y =
            0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          sum += y;
          sumSq += y * y;
          if (y < 160) dark++;
        }
        const mean = sum / px;
        const variance = sumSq / px - mean * mean;
        const darkRatio = dark / px;

        // Thresholds tuned to catch a flat opaque fill (variance ~ 0)
        // while allowing normal text (variance well above 100).
        if (variance < 40) {
          failures.push({
            page: l.page,
            rect: l.rect,
            text: l.text,
            reason: `Region appears flat (variance ${variance.toFixed(1)}) — citation may be covered by an opaque overlay.`,
          });
        } else if (darkRatio < 0.01) {
          failures.push({
            page: l.page,
            rect: l.rect,
            text: l.text,
            reason: "Region has no dark pixels — citation glyphs missing.",
          });
        }
      }
    }
  } finally {
    await pdf.cleanup();
  }
  return failures;
}
