/**
 * Citation Hyperlinker — annotation writer.
 *
 * Appends URI /Link annotations to an existing PDF using pdf-lib, without
 * touching the page content stream and without stripping any existing
 * annotations (unlike `src/lib/outline/write.ts::exportPdf`, which rebuilds
 * outlines and replaces every /Link).
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFContext,
} from "pdf-lib";

export interface CitationLinkInput {
  page: number;
  rect: [number, number, number, number];
  url: string;
  /** Human-readable citation text — stored as /Contents for accessibility. */
  text?: string;
}

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
 * Load `sourceBytes`, append URI link annotations for each entry, save.
 * Non-destructive: existing annotations (highlights, form widgets, other
 * links) are preserved.
 */
export async function applyCitationLinks(
  sourceBytes: Uint8Array,
  links: CitationLinkInput[],
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
