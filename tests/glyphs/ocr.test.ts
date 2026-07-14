import { describe, expect, it } from "vitest";
import { ocrPageToGlyphs } from "@/lib/glyphs/ocr";

describe("ocrPageToGlyphs", () => {
  it("uses char-level boxes when available", () => {
    const glyphs = ocrPageToGlyphs({
      page: 0,
      words: [{
        text: "hi",
        bbox: { x: 0, y: 0, w: 20, h: 10 },
        chars: [
          { char: "h", bbox: { x: 0,  y: 0, w: 8, h: 10 } },
          { char: "i", bbox: { x: 10, y: 0, w: 4, h: 10 } },
        ],
      }],
    });
    expect(glyphs.map((g) => g.char).join("")).toBe("hi");
    expect(glyphs[0].source).toBe("ocr");
    expect(glyphs[1].advance).toBe(4);
  });

  it("splits word-level fallback into equal advances", () => {
    const glyphs = ocrPageToGlyphs({
      page: 0,
      words: [{ text: "abcd", bbox: { x: 0, y: 0, w: 40, h: 10 } }],
    });
    expect(glyphs).toHaveLength(4);
    for (const g of glyphs) expect(g.advance).toBe(10);
  });
});
