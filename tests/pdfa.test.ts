/**
 * PDF/A-2b regression guard.
 *
 * The PDF/A pipeline is fragile: any later change that re-saves the bytes,
 * touches the catalog, or introduces a non-embedded font silently breaks
 * compliance. This test exercises toPdfA() on a fixture document and
 * asserts the output meets every core PDF/A-2b requirement we ship.
 *
 * If a future commit regresses ANY of these (OutputIntent, XMP pdfaid,
 * trailer /ID, font embedding, no encryption, no JS), this test fails at
 * `bun test` — never at the courthouse.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { toPdfA, verifyPdfAStructuralAsync, findUnembeddedFonts } from "@/lib/pdf/to-pdfa";
import { setFontLoader, type FontKind, fontFileName } from "@/lib/pdf/fonts-pdfa";

beforeAll(() => {
  // tests/setup.ts patches fetch, but be explicit so this suite is
  // independent of fetch-monkey-patching order.
  setFontLoader(async (kind: FontKind) => {
    const p = path.resolve(__dirname, "..", "public", "fonts", "liberation", fontFileName(kind));
    return new Uint8Array(await readFile(p));
  });
});

/** Build a fixture PDF that references Standard 14 Helvetica (NOT embedded) —
 *  exactly the shape of a PDF freshly authored by pdf-lib. */
async function buildFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Fixture for PDF/A regression test");
  doc.setAuthor("CounselPDF tests");
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("The quick brown fox jumps over the lazy dog.", {
    x: 72, y: 720, size: 12, font: helv,
  });
  page.drawText("PDF/A-2b compliance is non-optional for court filings.", {
    x: 72, y: 700, size: 12, font: helv,
  });
  return doc.save();
}

describe("PDF/A-2b export — regression guard", () => {
  it("toPdfA() produces bytes that satisfy every structural requirement", async () => {
    const input = await buildFixture();

    // Sanity: the fixture starts with an UN-embedded Standard 14 font.
    const before = await PDFDocument.load(input);
    expect(findUnembeddedFonts(before).length).toBeGreaterThan(0);

    const out = await toPdfA(input);
    const report = await verifyPdfAStructuralAsync(out);

    // If anything fails, the assertion message names the failing clause(s)
    // so a regression is debuggable without re-running locally.
    expect(report.missing, `PDF/A missing: ${report.missing.join("; ")}`).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.outputIntent).toBe(true);
    expect(report.xmpPart).toBe(true);
    expect(report.xmpConformance).toBe(true);
    expect(report.trailerId).toBe(true);
    expect(report.fontsEmbedded).toBe(true);
    expect(report.noEncryption).toBe(true);
    expect(report.noJavaScript).toBe(true);
    expect(report.unembeddedFonts).toEqual([]);
  });

  it("detects regressions: stripping the OutputIntent fails verification", async () => {
    const input = await buildFixture();
    const out = await toPdfA(input);
    // Simulate a downstream regression that nukes the sRGB OutputIntent.
    const broken = new TextDecoder("latin1").decode(out).replace(/GTS_PDFA1/g, "GTS_NONE");
    const brokenBytes = new TextEncoder().encode(broken);
    const report = await verifyPdfAStructuralAsync(brokenBytes);
    expect(report.ok).toBe(false);
    expect(report.outputIntent).toBe(false);
    expect(report.missing.join(",")).toMatch(/OutputIntent/);
  });
});
