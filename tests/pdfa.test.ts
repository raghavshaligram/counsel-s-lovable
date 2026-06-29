/**
 * PDF/A-2b regression guard.
 *
 * The PDF/A pipeline must be SELF-CORRECTING: regardless of the input
 * document's prior state (rasterized scans with /Interpolate true,
 * transparency groups without /CS, /Launch actions, unembedded Standard 14
 * fonts), toPdfA() must produce a buffer that passes every structural
 * requirement we check. This suite throws adversarial fixtures at it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream,
  StandardFonts,
} from "pdf-lib";
import { toPdfA, verifyPdfAStructuralAsync, findUnembeddedFonts } from "@/lib/pdf/to-pdfa";
import { setFontLoader, type FontKind, fontFileName } from "@/lib/pdf/fonts-pdfa";

beforeAll(() => {
  setFontLoader(async (kind: FontKind) => {
    const p = path.resolve(__dirname, "..", "public", "fonts", "liberation", fontFileName(kind));
    return new Uint8Array(await readFile(p));
  });
});

/** Vanilla fixture: Standard 14 Helvetica only (unembedded). */
async function buildBasicFixture(): Promise<Uint8Array> {
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

/** Adversarial fixture: starts as basic, then injects every construct the
 *  PDF/A pass must clean up — unembedded font, /Interpolate true image,
 *  transparency /Group without /CS, and a /Launch action dict. */
async function buildAdversarialFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Adversarial fixture");
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Adversarial input.", { x: 72, y: 720, size: 12, font: helv });

  const ctx = doc.context;

  // Inject an image XObject with /Interpolate true.
  const pixel = new Uint8Array([0xff, 0xff, 0xff]); // 1x1 white RGB
  const imgDict = ctx.obj({
    Type: "XObject",
    Subtype: "Image",
    Width: 1,
    Height: 1,
    ColorSpace: "DeviceRGB",
    BitsPerComponent: 8,
    Length: pixel.length,
  });
  imgDict.set(PDFName.of("Interpolate"), PDFBool.True);
  const imgStream = PDFRawStream.of(imgDict, pixel);
  ctx.register(imgStream);

  // Inject a transparency /Group without /CS on the page node.
  const group = ctx.obj({ Type: "Group", S: "Transparency" });
  page.node.set(PDFName.of("Group"), group);

  // Inject a /Launch action dict.
  const launch = ctx.obj({ Type: "Action", S: "Launch" });
  launch.set(PDFName.of("F"), ctx.obj("/tmp/evil.sh") as unknown as PDFNumber);
  ctx.register(launch);

  // Inject /JS action.
  const js = ctx.obj({ Type: "Action", S: "JavaScript", JS: "app.alert('hi')" });
  ctx.register(js);

  // Drop /Info to force CreationDate to be re-minted by toPdfA.
  (ctx.trailerInfo as { Info?: unknown }).Info = ctx.obj({}) as unknown as PDFDict;

  return doc.save();
}

describe("PDF/A-2b export — self-correcting conformance", () => {
  it("turns a basic Standard-14 fixture into a fully compliant PDF/A-2b", async () => {
    const input = await buildBasicFixture();

    const before = await PDFDocument.load(input);
    expect(findUnembeddedFonts(before).length).toBeGreaterThan(0);

    const out = await toPdfA(input);
    const report = await verifyPdfAStructuralAsync(out);

    expect(report.missing, `PDF/A missing: ${report.missing.join("; ")}`).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.outputIntent).toBe(true);
    expect(report.xmpPart).toBe(true);
    expect(report.xmpConformance).toBe(true);
    expect(report.xmpDatesValid).toBe(true);
    expect(report.trailerId).toBe(true);
    expect(report.fontsEmbedded).toBe(true);
    expect(report.noEncryption).toBe(true);
    expect(report.noJavaScript).toBe(true);
    expect(report.noInterpolate).toBe(true);
    expect(report.unembeddedFonts).toEqual([]);
    expect(report.interpolateOffenders).toEqual([]);
  });

  it("self-heals an adversarial fixture (Interpolate / Launch / JS / transparency group / unembedded font)", async () => {
    const input = await buildAdversarialFixture();

    // Sanity: confirm the adversarial inputs are actually present BEFORE the pass.
    const pre = await verifyPdfAStructuralAsync(input);
    expect(pre.ok).toBe(false);
    expect(pre.interpolateOffenders.length).toBeGreaterThan(0);
    expect(pre.transparency.groupsWithoutColorSpace.length).toBeGreaterThan(0);
    expect(
      pre.forbiddenConstructs.launchActions.length
        + pre.forbiddenConstructs.javaScriptActions.length,
    ).toBeGreaterThan(0);

    const out = await toPdfA(input);
    const report = await verifyPdfAStructuralAsync(out);

    expect(report.missing, `PDF/A missing: ${report.missing.join("; ")}`).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.noInterpolate).toBe(true);
    expect(report.noJavaScript).toBe(true);
    expect(report.transparency.groupsWithoutColorSpace).toEqual([]);
    expect(report.forbiddenConstructs.launchActions).toEqual([]);
    expect(report.xmpDatesValid).toBe(true);
  });

  it("is idempotent — running toPdfA twice still validates", async () => {
    const input = await buildAdversarialFixture();
    const once = await toPdfA(input);
    const twice = await toPdfA(once);
    const report = await verifyPdfAStructuralAsync(twice);
    expect(report.missing, `PDF/A missing: ${report.missing.join("; ")}`).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("detects regressions: stripping the OutputIntent fails verification", async () => {
    const input = await buildBasicFixture();
    const out = await toPdfA(input);
    const broken = new TextDecoder("latin1").decode(out).replace(/GTS_PDFA1/g, "GTS_NONE");
    const brokenBytes = new TextEncoder().encode(broken);
    const report = await verifyPdfAStructuralAsync(brokenBytes);
    expect(report.ok).toBe(false);
    expect(report.outputIntent).toBe(false);
    expect(report.missing.join(",")).toMatch(/OutputIntent/);
  });

  it("detects regressions: a fractional-second xmp:CreateDate fails the date check", async () => {
    const input = await buildBasicFixture();
    const out = await toPdfA(input);
    const text = new TextDecoder("latin1").decode(out);
    const broken = text.replace(
      /<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/,
      "<xmp:CreateDate>2026-06-29T14:30:00.000Z</xmp:CreateDate>",
    );
    const report = await verifyPdfAStructuralAsync(new TextEncoder().encode(broken));
    expect(report.xmpDatesValid).toBe(false);
    expect(report.missing.join(",")).toMatch(/CreateDate/);
  });
});
