/**
 * Build-time guard for the runtime redaction gate.
 *
 * Builds a fixture PDF that carries the SAME sensitive value in every
 * vector an attacker could mine post-export:
 *
 *   - body page text
 *   - prose name in another paragraph
 *   - table-cell-like text
 *   - AcroForm form-field value (/V)
 *   - annotation /Contents
 *   - document Info-dict metadata (Author, Subject, Keywords)
 *
 * Then runs `enforceRedactionGate` and asserts:
 *
 *   1. With redaction targets that name the secret + cover the on-page
 *      text rectangles, the gate produces bytes from which the secret
 *      cannot be recovered in ANY vector (including raw stream bytes).
 *   2. If we deliberately break the gate by feeding it bytes that still
 *      have the secret in a form field, it THROWS — never silently
 *      returns "ok". This is what protects future code changes from
 *      shipping a leak.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { enforceRedactionGate, RedactionGateError } from "@/lib/editor/redaction-gate";

const SECRET = "987-65-4321";

async function buildEveryVectorFixture(): Promise<{
  bytes: Uint8Array;
  rects: { page: number; rect: { x: number; y: number; w: number; h: number } }[];
}> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Case file for John Q Public ${SECRET}`);
  doc.setAuthor(`John Q Public ${SECRET}`);
  doc.setSubject(`SSN ${SECRET}`);
  doc.setKeywords([`ssn:${SECRET}`, "confidential"]);

  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);

  // Body text + prose + "table" cell — three different page-text contexts.
  page.drawText(`SSN: ${SECRET}`, { x: 72, y: 720, size: 12, font: helv });
  page.drawText(`Per discovery, claimant ${SECRET} confirmed receipt.`, { x: 72, y: 690, size: 12, font: helv });
  page.drawText(`Row 1 | ${SECRET} | $1,200`, { x: 72, y: 660, size: 12, font: helv });

  // Form field carrying the same secret as /V.
  const form = doc.getForm();
  const field = form.createTextField("ssn_field");
  field.setText(SECRET);
  field.addToPage(page, { x: 72, y: 600, width: 220, height: 24 });

  // Annotation /Contents with the secret.
  const ctx = doc.context;
  const annot = ctx.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [400, 720, 460, 740],
  });
  annot.set(PDFName.of("Contents"), PDFString.of(`Reviewer note: SSN ${SECRET} verified`));
  const annotRef = ctx.register(annot);
  const existing = page.node.Annots();
  if (existing) {
    existing.push(annotRef);
  } else {
    page.node.set(PDFName.of("Annots"), ctx.obj([annotRef]));
  }

  const bytes = await doc.save({ useObjectStreams: false });

  // Cover rects for every on-page occurrence (rough — gate force-rasters
  // any leaking page anyway).
  const rects = [
    { page: 0, rect: { x: 60, y: 60, w: 500, h: 90 } },   // top band: SSN line + prose + table
    { page: 0, rect: { x: 60, y: 180, w: 320, h: 50 } },  // form-field band
  ];
  return { bytes, rects };
}

describe("redaction gate (build-time regression)", () => {
  it("delivers bytes with zero recoverable secret across every vector", async () => {
    const { bytes, rects } = await buildEveryVectorFixture();
    const targets = rects.map((r) => ({ page: r.page, rect: r.rect, text: SECRET, label: "ssn" }));

    const { bytes: out, verify } = await enforceRedactionGate(bytes, targets);
    expect(verify.ok).toBe(true);
    expect(verify.vectors.page).toBe(0);
    expect(verify.vectors.formField).toBe(0);
    expect(verify.vectors.annotation).toBe(0);
    expect(verify.vectors.rawStream).toBe(0);
    expect(verify.vectors.attachment).toBe(0);

    // Hard byte-level guarantee: secret is not in the raw output AND not
    // in any flate-decompressed sub-stream.
    expect(containsAnywhere(out, SECRET)).toBe(false);
  });

  it("throws RedactionGateError if a vector still contains a redacted value", async () => {
    // Simulate a regression: someone changes sanitize so /V is no longer
    // cleared. We feed the gate the raw fixture with alreadySanitized=true
    // so the gate's own sanitize pass is skipped — verification must catch
    // the leak and throw.
    const { bytes, rects } = await buildEveryVectorFixture();
    const targets = rects.map((r) => ({ page: r.page, rect: r.rect, text: SECRET, label: "ssn" }));

    await expect(
      enforceRedactionGate(bytes, targets, { alreadySanitized: true }),
    ).rejects.toBeInstanceOf(RedactionGateError);
  });
});

function containsAnywhere(bytes: Uint8Array, needle: string): boolean {
  const txt = new TextDecoder("latin1").decode(bytes);
  if (txt.includes(needle)) return true;
  // Hex-encoded form (pdf-lib often writes Tj hex strings).
  const hex = Array.from(needle).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  if (txt.toLowerCase().includes(hex)) return true;
  // UTF-16BE hex (form-field /V is stored this way after BOM).
  const u16hex = "feff" + Array.from(needle).map((c) =>
    c.charCodeAt(0).toString(16).padStart(4, "0"),
  ).join("");
  if (txt.toLowerCase().includes(u16hex)) return true;
  // Decompress every flate stream and search inside.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unzlibSync } = require("fflate") as typeof import("fflate");
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) {
    try {
      const raw = new Uint8Array(m[1].length);
      for (let i = 0; i < m[1].length; i++) raw[i] = m[1].charCodeAt(i) & 0xff;
      const out = unzlibSync(raw);
      const decoded = new TextDecoder("latin1").decode(out);
      if (decoded.includes(needle)) return true;
      if (decoded.toLowerCase().includes(hex)) return true;
      if (decoded.toLowerCase().includes(u16hex)) return true;
    } catch { /* not flate */ }
  }
  return false;
}
