/**
 * Regression guard: sanitizePdfBytes strips document metadata.
 *
 * After redaction/sanitize, Title/Author/Subject/Keywords MUST contain
 * none of the sensitive values that may have been placed there by the
 * authoring tool. This test fails loudly if the metadata wipe ever
 * regresses.
 */
import { describe, it, expect } from "vitest";
import {
  PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, StandardFonts,
} from "pdf-lib";
import { unzlibSync } from "fflate";
import { sanitizePdfBytes } from "@/lib/pdf/sanitize";
import { verifyRedactionRemoval } from "@/lib/editor/verify-redaction";

const SECRETS = [
  "Jonathan A. Meriwether",
  "123-45-6789",
  "4111 1111 1111 1111",
  "Acme Holdings — Settlement",
];

async function buildPdfWithSensitiveMetadata(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Confidential memo re ${SECRETS[0]}`);
  doc.setAuthor(SECRETS[0]);
  doc.setSubject(`SSN ${SECRETS[1]} / card ${SECRETS[2]}`);
  doc.setKeywords([SECRETS[3], "privileged", "settlement"]);
  doc.setProducer("Internal tool 1.0");
  doc.setCreator("Internal tool 1.0");
  const page = doc.addPage([400, 200]);
  page.drawText("Body content stays where it is.", { x: 40, y: 120, size: 12 });
  return doc.save();
}

describe("sanitizePdfBytes — metadata true-deletion", () => {
  it("clears Title/Author/Subject/Keywords (info dictionary wipe)", async () => {
    const inBytes = await buildPdfWithSensitiveMetadata();
    const out = await sanitizePdfBytes(inBytes);
    const after = await PDFDocument.load(out);
    expect(after.getTitle() ?? "").toBe("");
    expect(after.getAuthor() ?? "").toBe("");
    expect(after.getSubject() ?? "").toBe("");
    expect(after.getKeywords() ?? "").toBe("");
    // Note: pdf-lib stamps its own Producer on save; the contract for
    // sanitize is that no caller-supplied sensitive value survives, not
    // that the field is necessarily empty. That contract is enforced by
    // the next test (no-leak assertion).
  });

  it("leaks no sensitive value through the document info dictionary", async () => {
    const inBytes = await buildPdfWithSensitiveMetadata();
    const out = await sanitizePdfBytes(inBytes);
    const after = await PDFDocument.load(out);
    const info = [
      after.getTitle(),
      after.getAuthor(),
      after.getSubject(),
      after.getKeywords(),
      after.getProducer(),
      after.getCreator(),
    ]
      .filter(Boolean)
      .join(" | ");
    for (const secret of SECRETS) {
      expect(info.includes(secret)).toBe(false);
    }
  });

  it("preserves page count (visible body content is not destroyed)", async () => {
    const inBytes = await buildPdfWithSensitiveMetadata();
    const out = await sanitizePdfBytes(inBytes);
    const after = await PDFDocument.load(out);
    expect(after.getPageCount()).toBe(1);
  });
});



// --------------------------------------------------------------------------
// All-vector coverage: form field + annotation + hidden layer + attachment.
// --------------------------------------------------------------------------

const VECTOR_SECRETS = {
  formField: "Patient: Jane Roe, DOB 1971-03-14",
  annotation: "Privileged note re settlement $4.2M",
  hiddenLayer: "Sealed exhibit B — witness identity",
  attachment: "social_security_numbers.csv",
};

async function buildPdfWithAllVectors(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("Public-facing body content.", { x: 72, y: 720, size: 12 });
  const ctx = doc.context;

  // (a) AcroForm field with a sensitive value -----------------------------
  const fieldDict = ctx.obj({
    FT: "Tx",
    T: "patient_name",
    Ff: 0,
  });
  fieldDict.set(PDFName.of("V"), PDFString.of(VECTOR_SECRETS.formField));
  fieldDict.set(PDFName.of("DV"), PDFString.of(VECTOR_SECRETS.formField));
  const fieldRef = ctx.register(fieldDict);
  const acroForm = ctx.obj({ NeedAppearances: true });
  acroForm.set(PDFName.of("Fields"), ctx.obj([fieldRef]));
  doc.catalog.set(PDFName.of("AcroForm"), acroForm);

  // (b) Text annotation (sticky note) -----------------------------------
  const annot = ctx.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [100, 100, 120, 120],
  });
  annot.set(PDFName.of("Contents"), PDFHexString.fromText(VECTOR_SECRETS.annotation));
  annot.set(PDFName.of("T"), PDFString.of("Counsel"));
  const annotRef = ctx.register(annot);
  page.node.set(PDFName.of("Annots"), ctx.obj([annotRef]));

  // (c) Hidden layer (OCG) with a gated annotation ----------------------
  const ocg = ctx.obj({ Type: "OCG", Name: "Sealed exhibits" });
  const ocgRef = ctx.register(ocg);
  const ocProps = ctx.obj({});
  ocProps.set(PDFName.of("OCGs"), ctx.obj([ocgRef]));
  // Default config marks the OCG as OFF (hidden).
  const dConfig = ctx.obj({ Name: "Default", BaseState: "ON" });
  dConfig.set(PDFName.of("OFF"), ctx.obj([ocgRef]));
  ocProps.set(PDFName.of("D"), dConfig);
  doc.catalog.set(PDFName.of("OCProperties"), ocProps);

  const hiddenAnnot = ctx.obj({
    Type: "Annot",
    Subtype: "FreeText",
    Rect: [200, 200, 400, 220],
  });
  hiddenAnnot.set(PDFName.of("Contents"), PDFHexString.fromText(VECTOR_SECRETS.hiddenLayer));
  hiddenAnnot.set(PDFName.of("OC"), ocgRef);
  const hiddenAnnotRef = ctx.register(hiddenAnnot);
  const annotsArr = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)!;
  annotsArr.push(hiddenAnnotRef);

  // (d) Embedded file attachment ----------------------------------------
  const fileBytes = new TextEncoder().encode(
    "name,ssn\nJane Roe,123-45-6789\nJohn Doe,987-65-4321\n",
  );
  const efStreamDict = ctx.obj({
    Type: "EmbeddedFile",
    Subtype: "text/csv",
    Length: fileBytes.length,
  });
  const efStream = PDFRawStream.of(efStreamDict, fileBytes);
  const efStreamRef = ctx.register(efStream);
  const efDict = ctx.obj({});
  efDict.set(PDFName.of("F"), efStreamRef);
  const filespec = ctx.obj({
    Type: "Filespec",
    F: PDFString.of(VECTOR_SECRETS.attachment),
    UF: PDFString.of(VECTOR_SECRETS.attachment),
  });
  filespec.set(PDFName.of("EF"), efDict);
  const filespecRef = ctx.register(filespec);
  const efTreeNames = ctx.obj([PDFString.of(VECTOR_SECRETS.attachment), filespecRef]);
  const efTree = ctx.obj({});
  efTree.set(PDFName.of("Names"), efTreeNames);
  const namesDict = ctx.obj({});
  namesDict.set(PDFName.of("EmbeddedFiles"), efTree);
  doc.catalog.set(PDFName.of("Names"), namesDict);
  void PDFBool.True; void PDFDict; // silence unused-import linter

  return doc.save();
}

describe("sanitize covers EVERY text-bearing vector", () => {
  it("clears form fields, annotation text, hidden layers, and attachments", async () => {
    const input = await buildPdfWithAllVectors();
    const clean = await sanitizePdfBytes(input);

    // Re-load and assert nothing recognizable survives.
    const after = await PDFDocument.load(clean, { ignoreEncryption: true, updateMetadata: false });
    const ctx = after.context;

    // No form field /V values.
    let formValues = 0;
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.has(PDFName.of("FT")) && obj.has(PDFName.of("V"))) {
        formValues++;
      }
    }
    expect(after.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    expect(formValues).toBe(0);

    // No text annotations carrying /Contents.
    let annotTextHits = 0;
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      if (obj.has(PDFName.of("Contents"))) {
        const v = obj.get(PDFName.of("Contents")) as unknown as { decodeText?: () => string };
        const t = typeof v.decodeText === "function" ? v.decodeText() : "";
        for (const s of Object.values(VECTOR_SECRETS)) {
          if (t.includes(s)) annotTextHits++;
        }
      }
    }
    expect(annotTextHits).toBe(0);

    // /OCProperties removed.
    expect(after.catalog.has(PDFName.of("OCProperties"))).toBe(false);

    // No /Filespec / /EF / /EmbeddedFiles.
    let attachmentHits = 0;
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const type = obj.get(PDFName.of("Type")) as unknown as { asString?: () => string };
      if ((type?.asString?.() ?? "") === "/Filespec") attachmentHits++;
      if (obj.has(PDFName.of("EF"))) attachmentHits++;
    }
    const names = after.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    expect(names?.has(PDFName.of("EmbeddedFiles")) ?? false).toBe(false);
    expect(attachmentHits).toBe(0);

    // Raw byte scan: none of the secrets remain in the file.
    const raw = new TextDecoder("latin1").decode(clean);
    for (const secret of Object.values(VECTOR_SECRETS)) {
      expect(raw.includes(secret), `secret leaked: ${secret}`).toBe(false);
    }
  });

  it("clears clientSSN /V and /DV, removes /AP, and leaves the SSN/card nowhere", async () => {
    const ssn = "987-65-4321";
    const card = "4539148803436467";
    const secret = `FORMFIELD-SECRET: SSN ${ssn} Card ${card}`;
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Visible non-sensitive body", { x: 72, y: 720, size: 12, font: helv });
    const form = doc.getForm();
    const field = form.createTextField("clientSSN");
    field.setText(secret);
    field.addToPage(page, { x: 72, y: 650, width: 360, height: 26 });
    const input = await doc.save({ useObjectStreams: false });

    const clean = await sanitizePdfBytes(input, { sensitiveStrings: [secret, ssn, card] });
    const after = await PDFDocument.load(clean, { ignoreEncryption: true, updateMetadata: false });
    const ctx = after.context;
    let clientFieldObjects = 0;
    let fieldValueLeaks = 0;
    let appearanceLeaks = 0;
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const name = pdfText(obj.get(PDFName.of("T")));
      const v = pdfText(obj.get(PDFName.of("V")));
      const dv = pdfText(obj.get(PDFName.of("DV")));
      if (name === "clientSSN") clientFieldObjects++;
      if (v.includes(secret) || dv.includes(secret)) fieldValueLeaks++;
      if (name === "clientSSN" && obj.has(PDFName.of("AP"))) appearanceLeaks++;
    }
    const acroForm = after.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
    const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
    expect(fields?.size() ?? 0).toBe(0);
    expect(clientFieldObjects).toBe(0);
    expect(fieldValueLeaks).toBe(0);
    expect(appearanceLeaks).toBe(0);
    expect(containsAnywhere(clean, ssn)).toBe(false);
    expect(containsAnywhere(clean, card)).toBe(false);
    expect(containsAnywhere(clean, secret)).toBe(false);
    const verify = await verifyRedactionRemoval(clean, [
      { page: 0, text: secret },
      { page: 0, text: ssn },
      { page: 0, text: card },
    ]);
    expect(verify.leaks).toEqual([]);
  });

  it("verifyRedactionRemoval flags leaks across form/annotation/layer/attachment vectors", async () => {
    const input = await buildPdfWithAllVectors();
    const targets = Object.values(VECTOR_SECRETS).map((text) => ({ page: 0, text }));
    const before = await verifyRedactionRemoval(input, targets);
    expect(before.ok).toBe(false);
    expect(before.vectors.formField).toBeGreaterThan(0);
    expect(before.vectors.annotation).toBeGreaterThan(0);
    expect(before.vectors.attachment).toBeGreaterThan(0);
    // hidden layer presence reports as either annotation (gated annot)
    // or hidden-layer (OCG-bearing object) — at least one of those.
    expect(before.vectors.annotation + before.vectors.hiddenLayer).toBeGreaterThan(0);

    const clean = await sanitizePdfBytes(input);
    const after = await verifyRedactionRemoval(clean, targets);
    expect(
      after.leaks,
      `unexpected leaks after sanitize: ${after.leaks.map((l) => `${l.vector}:${l.text}`).join(" | ")}`,
    ).toEqual([]);
    expect(after.ok).toBe(true);
  });
});

function pdfText(obj: unknown): string {
  if (!obj) return "";
  try {
    const o = obj as { decodeText?: () => string; asString?: () => string; toString?: () => string };
    if (typeof o.decodeText === "function") return o.decodeText();
    if (typeof o.asString === "function") return o.asString();
    return o.toString?.() ?? "";
  } catch { return ""; }
}

function containsAnywhere(bytes: Uint8Array, needle: string): boolean {
  const txt = new TextDecoder("latin1").decode(bytes);
  if (txt.includes(needle)) return true;
  const hex = Array.from(needle).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  if (txt.toLowerCase().includes(hex)) return true;
  const u16hex = "feff" + Array.from(needle).map((c) =>
    c.charCodeAt(0).toString(16).padStart(4, "0"),
  ).join("");
  if (txt.toLowerCase().includes(u16hex)) return true;
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

