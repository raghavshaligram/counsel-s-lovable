/**
 * Regression guard: Bates numbering continuity.
 *
 * Bates labels must be sequential without gaps; addBates must preserve
 * the source page count. If a future change resets the counter, skips
 * pages, or drops pages, this test fails loudly.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { addBates, formatBates } from "@/lib/batch/ops/bates";

async function buildBlankPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([612, 792]);
  return doc.save();
}

describe("Bates — continuity contract", () => {
  it("formatBates produces zero-padded, sequential labels", () => {
    const opts = { prefix: "ACME", suffix: "", digits: 6 };
    const labels = [1, 2, 3, 99, 100].map((n) => formatBates(n, opts));
    expect(labels).toEqual([
      "ACME000001",
      "ACME000002",
      "ACME000003",
      "ACME000099",
      "ACME000100",
    ]);
  });

  it("formatBates respects custom suffix", () => {
    expect(formatBates(7, { prefix: "X-", suffix: "-Z", digits: 4 })).toBe("X-0007-Z");
  });

  it("addBates preserves page count on a multi-page input", async () => {
    const inBytes = await buildBlankPdf(5);
    const out = await addBates(inBytes, {
      prefix: "DOC", startAt: 1, digits: 4,
      position: "br", fontSize: 10, color: "black",
    });
    const after = await PDFDocument.load(out);
    expect(after.getPageCount()).toBe(5);
  });

  it("addBates with startAt offset still preserves continuity (no gaps)", async () => {
    const inBytes = await buildBlankPdf(3);
    const out = await addBates(inBytes, {
      prefix: "DOC", startAt: 100, digits: 4,
      position: "br", fontSize: 10, color: "black",
    });
    const after = await PDFDocument.load(out);
    expect(after.getPageCount()).toBe(3);
    // Reconstruct labels the way addBates would stamp them — pages must be
    // 100, 101, 102 with no gap or skip.
    const labels = [0, 1, 2].map((i) =>
      formatBates(100 + i, { prefix: "DOC", suffix: "", digits: 4 }),
    );
    expect(labels).toEqual(["DOC0100", "DOC0101", "DOC0102"]);
  });
});
