/**
 * Regression guard: combined Citations + TOA pipeline.
 *
 * The ONE-SHOT `buildCombinedCitationsAndToa` MUST produce:
 *   - external URI /Link annotations on INLINE body citations
 *     (CourtListener / Cornell), never on the TOA page itself
 *   - internal /Dest /Link annotations on TOA authority names AND on
 *     TOA page-number tokens
 *   - exactly ONE TOA page even after repeat runs (double-prepend guard)
 */
import { describe, it, expect } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import {
  buildCombinedCitationsAndToa,
  prependToaToPdf,
  type ToaEntry,
} from "@/lib/citations/toa";

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

/**
 * Build a source PDF with a real body citation on page 3 so
 * `detectCitations` has something to link externally.
 */
async function makeBriefWithBodyCitation(): Promise<Uint8Array> {
  const src = await PDFDocument.create();
  const font = await src.embedFont(StandardFonts.TimesRoman);
  for (let i = 0; i < 10; i++) {
    const p = src.addPage([612, 792]);
    if (i === 2) {
      // "384 U.S. 436" — matches the us-supreme PATTERN.
      p.drawText("See Miranda v. Arizona, 384 U.S. 436 for the rule.", {
        x: 72,
        y: 700,
        font,
        size: 12,
      });
    }
  }
  return src.save();
}

describe("Combined Citations + TOA — one action", () => {
  it("TOA page has NO external URIs — authority names are internal /Dest jumps only", async () => {
    const srcBytes = await makeBriefWithBodyCitation();
    const out = await buildCombinedCitationsAndToa(srcBytes, ENTRIES);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(11); // 1 TOA + 10 brief

    const { uris, destCount } = await summarize(out, 0);
    // No external URIs on the TOA page.
    expect(uris).toHaveLength(0);
    // 2 authority-name internal jumps + 3 page-number tokens (3, 7, 5) = 5.
    expect(destCount).toBe(5);
  });

  it("inline body citations get external URI links (Citation Hyperlinker behavior)", async () => {
    const srcBytes = await makeBriefWithBodyCitation();
    const out = await buildCombinedCitationsAndToa(srcBytes, ENTRIES);
    // Body page 3 in original brief → page 4 (index 3) after 1-page TOA shift.
    const bodyIdx = 3;
    const { uris } = await summarize(out, bodyIdx);
    expect(uris.length).toBeGreaterThan(0);
    expect(uris.some((u) => u.includes("courtlistener.com"))).toBe(true);
  });

  it("re-running is idempotent — no duplicate TOA, no duplicate body links", async () => {
    const srcBytes = await makeBriefWithBodyCitation();
    const once = await buildCombinedCitationsAndToa(srcBytes, ENTRIES);
    const twice = await buildCombinedCitationsAndToa(once, ENTRIES);
    const doc = await PDFDocument.load(twice);
    expect(doc.getPageCount()).toBe(11);
    const toa = await summarize(twice, 0);
    expect(toa.uris).toHaveLength(0);
    expect(toa.destCount).toBe(5);
  });

  it("prependToaToPdf alone (no body-linking) still guards against duplicate TOA", async () => {
    const src = await PDFDocument.create();
    for (let i = 0; i < 10; i++) src.addPage([612, 792]);
    const srcBytes = await src.save();
    const once = await prependToaToPdf(srcBytes, ENTRIES);
    const twice = await prependToaToPdf(once, ENTRIES);
    const doc = await PDFDocument.load(twice);
    expect(doc.getPageCount()).toBe(11);
  });
});
