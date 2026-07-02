/**
 * Regression guard: Table of Authorities is self-contained.
 *
 * A single TOA generation MUST produce, without any prior Citation
 * Hyperlinker run:
 *   - external URI /Link annotations on every authority display line
 *     (case name / statute citation), pointing at CourtListener / Cornell
 *   - internal /Dest /Link annotations on every page-number token,
 *     targeting the SHIFTED page index in the combined PDF
 *   - a TOA page marker so a later Citation Hyperlinker run skips the
 *     TOA page instead of re-linking its entries externally
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
import { buildToaPdfBytes, prependToaToPdf, type ToaEntry } from "@/lib/citations/toa";

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

describe("TOA — self-contained links", () => {
  it("TOA-only PDF has external URI links for every authority", async () => {
    const bytes = await buildToaPdfBytes(ENTRIES);
    const { uris, destCount } = await summarize(bytes, 0);
    expect(uris.length).toBeGreaterThanOrEqual(2);
    expect(uris.some((u) => u.includes("courtlistener.com"))).toBe(true);
    expect(uris.some((u) => u.includes("law.cornell.edu"))).toBe(true);
    // Standalone TOA has no target brief — no internal /Dest links.
    expect(destCount).toBe(0);
  });

  it("Combined PDF prepends TOA with BOTH external URI and internal /Dest links", async () => {
    const src = await PDFDocument.create();
    for (let i = 0; i < 10; i++) src.addPage([612, 792]);
    const srcBytes = await src.save();

    const combined = await prependToaToPdf(srcBytes, ENTRIES);
    const combinedDoc = await PDFDocument.load(combined);
    expect(combinedDoc.getPageCount()).toBe(11);

    const { uris, destCount } = await summarize(combined, 0);
    // External URI on every authority (Miranda + statute)
    expect(uris.length).toBeGreaterThanOrEqual(2);
    expect(uris.some((u) => u.includes("384%20U.S.%20436"))).toBe(true);
    // Internal /Dest for each page-number token: 3, 7, 5 → 3 links.
    expect(destCount).toBe(3);
  });
});
