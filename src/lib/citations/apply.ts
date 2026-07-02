/**
 * Citation Hyperlinker — annotation writer.
 *
 * Appends URI /Link annotations to an existing PDF using pdf-lib, without
 * touching the page content stream and without stripping any existing
 * annotations (unlike `src/lib/outline/write.ts::exportPdf`, which rebuilds
 * outlines and replaces every /Link).
 *
 * In addition to the invisible /Link annotation, we bake a visible link
 * affordance directly into the page content stream so the citation reads
 * as a hyperlink in any PDF viewer — a legal-brief-blue underline under
 * the citation rect and, when the "tinted" style is selected, a subtle
 * translucent blue wash over the text.
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

export type CitationLinkStyle = "underline" | "underline-tint";

export interface CitationLinkInput {
  page: number;
  rect: [number, number, number, number];
  url: string;
  /** Human-readable citation text — stored as /Contents for accessibility. */
  text?: string;
}

/** Legal-brief link blue — matches Bluebook / Word default hyperlink hue. */
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
 * Load `sourceBytes`, append URI link annotations for each entry (plus the
 * visible underline / tint), save. Non-destructive to existing annotations.
 */
export async function applyCitationLinks(
  sourceBytes: Uint8Array,
  links: CitationLinkInput[],
  style: CitationLinkStyle = "underline",
): Promise<Uint8Array> {
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

    // ---- visible affordance (drawn UNDER new annotations) ----------------
    for (const l of pageLinks) {
      const [llx, lly, urx, ury] = l.rect;
      const width = Math.max(0, urx - llx);
      const height = Math.max(0, ury - lly);
      if (width <= 0 || height <= 0) continue;

      // Subtle blue wash behind the glyphs (tinted style only). Drawn first
      // so the underline sits on top, and low opacity keeps text legible.
      if (style === "underline-tint") {
        page.drawRectangle({
          x: llx,
          y: lly,
          width,
          height,
          color: LINK_BLUE,
          opacity: 0.12,
          borderWidth: 0,
        });
      }

      // Underline: 1-glyph-thick line just below the baseline of the rect.
      const thickness = Math.max(0.6, Math.min(1.2, height * 0.05));
      const underlineY = lly + Math.max(0.5, height * 0.04);
      page.drawLine({
        start: { x: llx, y: underlineY },
        end: { x: urx, y: underlineY },
        thickness,
        color: LINK_BLUE,
        opacity: 0.9,
      });
    }

    // ---- invisible URI /Link annotations ---------------------------------
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
