/**
 * Regression guard: sanitizePdfBytes strips document metadata.
 *
 * After redaction/sanitize, Title/Author/Subject/Keywords MUST contain
 * none of the sensitive values that may have been placed there by the
 * authoring tool. This test fails loudly if the metadata wipe ever
 * regresses.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { sanitizePdfBytes } from "@/lib/pdf/sanitize";

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
  it("clears Title/Author/Subject/Keywords/Producer/Creator", async () => {
    const inBytes = await buildPdfWithSensitiveMetadata();
    const out = await sanitizePdfBytes(inBytes);
    const after = await PDFDocument.load(out);
    expect(after.getTitle() ?? "").toBe("");
    expect(after.getAuthor() ?? "").toBe("");
    expect(after.getSubject() ?? "").toBe("");
    expect(after.getKeywords() ?? "").toBe("");
    expect(after.getProducer() ?? "").toBe("");
    expect(after.getCreator() ?? "").toBe("");
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
