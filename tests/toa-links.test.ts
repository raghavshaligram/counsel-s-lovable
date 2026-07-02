/**
 * Regression guard: TOA structure after the design change to a combined
 * citations + TOA pipeline.
 *
 * `buildCombinedCitationsAndToa` internally calls `detectCitations`
 * (browser-only: uses pdf.js) followed by `prependToaToPdf`. The tests
 * below cover the deterministic pdf-lib half (prepend + link geometry)
 * that runs in Node; the pdf.js-driven body-link step is exercised at
 * runtime in the browser.
 *
 * Contract enforced here:
 *   - TOA page has ZERO external URI /Link annotations
 *     (external lookups belong on inline body citations, not the TOA)
 *   - TOA page has internal /Dest /Link annotations for BOTH
 *     authority names AND page-number tokens
 *   - Re-running `prependToaToPdf` on a doc that already carries a TOA
 *     strips the old TOA (no duplication, no drift of internal targets)
 */
import { describe, it, expect } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { prependToaToPdf, type ToaEntry } from "@/lib/citations/toa";

const ENTRIES: ToaEntry[] = [
  {
    id: "1",
    section: "cases",
    display: "Miranda v. Arizona, 384 U.S. 436 (1966)",
    sortKey: "miranda",
    pages: [3, 7],
    citation: "384 U.S. 436",
    kind: "us-supreme",
  },
  {
    id: "2",
    section: "statutes",
    display: "42 U.S.C. § 1983",
    sortKey: "42 u.s.c",
    pages: [5],
    citation: "42 U.S.C. § 1983",
    kind: "us-code",
  },
];

interface AnnotSummary {
  uris: string[];
  destCount: number;
}

async function summarize(bytes: Uint8Array, pageIdx: number): Promise<AnnotSummary> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIdx);
  const annots = page.node.get(PDFName.of("Annots"));
  const out: AnnotSummary = { uris: [], destCount: 0 };
  if (!(annots instanceof PDFArray)) return out;
  for (let i = 0; i < annots.size(); i++) {
    let entry = annots.get(i);
    if (entry instanceof PDFRef) entry = doc.context.lookup(entry);
    if (!(entry instanceof PDFDict)) continue;
    const action = entry.get(PDFName.of("A"));
    if (action instanceof PDFDict) {
      const uri = action.get(PDFName.of("URI"));
      if (uri instanceof PDFString) out.uris.push(uri.decodeText());
      continue;
    }
    if (entry.get(PDFName.of("Dest"))) out.destCount++;
  }
  return out;
}

async function makeEmptyBrief(pages = 10): Promise<Uint8Array> {
  const src = await PDFDocument.create();
  for (let i = 0; i < pages; i++) src.addPage([612, 792]);
  return src.save();
}

describe("TOA — combined design", () => {
  it("prepended TOA has ZERO external URIs and only internal /Dest links", async () => {
    const srcBytes = await makeEmptyBrief();
    const out = await prependToaToPdf(srcBytes, ENTRIES);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(11);

    const { uris, destCount } = await summarize(out, 0);
    expect(uris).toHaveLength(0);
    // 2 authority-name jumps + 3 page-number tokens (3, 7, 5) = 5 internal links.
    expect(destCount).toBe(5);
  });

  it("re-prepending on a doc that already has a TOA strips the old one", async () => {
    const srcBytes = await makeEmptyBrief();
    const once = await prependToaToPdf(srcBytes, ENTRIES);
    const twice = await prependToaToPdf(once, ENTRIES);
    const doc = await PDFDocument.load(twice);
    // Idempotent: 1 TOA + 10 brief, not 2 TOA + 10.
    expect(doc.getPageCount()).toBe(11);
    const { uris, destCount } = await summarize(twice, 0);
    expect(uris).toHaveLength(0);
    expect(destCount).toBe(5);
  });
});
