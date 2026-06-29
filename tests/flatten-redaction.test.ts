/**
 * Regression test for the form-field → flatten → PDF/A leak.
 *
 * Scenario the user hit in production:
 *   1. A PDF carries a sensitive value in an AcroForm text field (/V).
 *   2. Flatten bakes the value into the page content stream as glyphs.
 *   3. Sanitize then deletes /V — too late, the page already has it.
 *   4. PDF/A export saves the file.
 *   5. pdftotext-style verification reports "clean" but the SSN is still
 *      recoverable from the raw page content stream.
 *
 * Guards:
 *   - flatten() refuses by default when sensitive form-field /V is present.
 *   - flatten({ clearSensitiveFirst: true }) wipes /V (and /AP appearance
 *     streams) so the baked output cannot contain the value.
 *   - verifyRedactionRemoval scans raw stream bytes, not just the text
 *     layer, and reports a "raw-stream" leak when a secret survives.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import {
  flatten,
  FlattenSensitiveDataError,
} from "@/lib/batch/ops/flatten";
import { sanitizePdfBytes } from "@/lib/pdf/sanitize";
import { verifyRedactionRemoval } from "@/lib/editor/verify-redaction";

const SECRET_SSN = "987-65-4321";

async function buildFormFieldFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Application form", { x: 72, y: 720, size: 16, font: helv });

  const form = doc.getForm();
  const field = form.createTextField("ssn");
  field.setText(SECRET_SSN);
  field.addToPage(page, { x: 72, y: 660, width: 220, height: 24 });
  // Object streams hide /V inside a compressed object — disable so the
  // test can search raw bytes for the literal value.
  return doc.save({ useObjectStreams: false });
}

function decompressAndContains(bytes: Uint8Array, needle: string): boolean {
  // Search the raw bytes AND every FlateDecode stream the file carries.
  // This is what an attacker (or veraPDF) would do post-export.
  const txt = new TextDecoder("latin1").decode(bytes);
  if (txt.includes(needle)) return true;
  // Brute-force scan every "stream\n…\nendstream" run for flate payloads.
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unzlibSync } = require("fflate") as typeof import("fflate");
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) {
    try {
      const raw = new Uint8Array(m[1].length);
      for (let i = 0; i < m[1].length; i++) raw[i] = m[1].charCodeAt(i) & 0xff;
      const out = unzlibSync(raw);
      if (new TextDecoder("latin1").decode(out).includes(needle)) return true;
    } catch { /* not a flate stream — ignore */ }
  }
  return false;
}

describe("flatten safety gate + raw-stream verification", () => {
  it("refuses to flatten a form field containing a sensitive value", async () => {
    const input = await buildFormFieldFixture();
    await expect(flatten(input, { forms: true, annotations: true }))
      .rejects.toBeInstanceOf(FlattenSensitiveDataError);
  });

  it("clears sensitive form-field /V before flattening when asked", async () => {
    const input = await buildFormFieldFixture();
    // Sanity: the fixture really does carry the SSN somewhere (pdf-lib
    // stores AcroForm /V as a UTF-16BE hex string, so the side-channel
    // verifier — not a raw byte scan — is the right pre-check).
    const pre = await verifyRedactionRemoval(input, [
      { page: 0, text: SECRET_SSN, label: "ssn" },
    ]);
    expect(pre.vectors.formField).toBeGreaterThan(0);

    const out = await flatten(input, {
      forms: true,
      annotations: true,
      clearSensitiveFirst: true,
    });

    // After safe-flatten, the literal SSN must not survive in any
    // decompressed stream (would mean it was baked into the page) and
    // there must be no form-field leak left.
    expect(decompressAndContains(out, SECRET_SSN)).toBe(false);
    const post = await verifyRedactionRemoval(out, [
      { page: 0, text: SECRET_SSN, label: "ssn" },
    ]);
    expect(post.vectors.formField).toBe(0);
    expect(post.vectors.rawStream).toBe(0);
  });

  it("raw-stream verification catches a secret baked into a content stream", async () => {
    // Build a doc that just draws the SSN directly into a page content stream.
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(`SSN ${SECRET_SSN}`, { x: 72, y: 720, size: 12, font: helv });
    const bytes = await doc.save({ useObjectStreams: false });

    const result = await verifyRedactionRemoval(bytes, [
      { page: 0, text: SECRET_SSN, label: "ssn" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.vectors.rawStream).toBeGreaterThan(0);
    expect(result.leaks.some((l) => l.vector === "raw-stream")).toBe(true);
  });

  it("sanitize + safe-flatten produces output the verification gate accepts", async () => {
    const input = await buildFormFieldFixture();
    const sanitized = await sanitizePdfBytes(input);
    const flattened = await flatten(sanitized, {
      forms: true,
      annotations: true,
      clearSensitiveFirst: true,
    });
    const result = await verifyRedactionRemoval(flattened, [
      { page: 0, text: SECRET_SSN, label: "ssn" },
    ]);
    expect(result.vectors.rawStream).toBe(0);
    expect(result.vectors.formField).toBe(0);
    expect(result.leaks.filter((l) => l.vector !== "page")).toEqual([]);
  });

  it("annotation /Contents with a sensitive value also blocks flatten", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const ctx = doc.context;
    const annot = ctx.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [72, 720, 200, 740],
    });
    annot.set(PDFName.of("Contents"), PDFString.of(`Account IBAN GB82 WEST 1234 5698 7654 32`));
    const annotRef = ctx.register(annot);
    page.node.set(PDFName.of("Annots"), ctx.obj([annotRef]));
    const bytes = await doc.save();

    await expect(flatten(bytes, { forms: true, annotations: true }))
      .rejects.toBeInstanceOf(FlattenSensitiveDataError);
  });
});
