import { describe, expect, it } from "vitest";
import { extractPageGlyphs } from "@/lib/glyphs/extract";
import { groupWords } from "@/lib/glyphs/words";

const font = () => ({ ascent: 0.75, descent: 0.25, unitsPerEm: 1000 });

describe("groupWords", () => {
  it("decomposes ligatures in word text", () => {
    const glyphs = extractPageGlyphs({
      page: 0,
      items: [{ str: "o\uFB01ce", transform: [10, 0, 0, 10, 0, 100], width: 40, height: 10, fontName: "f" }],
      getFont: font,
    });
    const words = groupWords(glyphs);
    expect(words).toHaveLength(1);
    expect(words[0].text).toBe("office");
  });

  it("splits on whitespace", () => {
    const glyphs = extractPageGlyphs({
      page: 0,
      items: [{ str: "hi there", transform: [10, 0, 0, 10, 0, 100], width: 80, height: 10, fontName: "f" }],
      getFont: font,
    });
    const words = groupWords(glyphs);
    expect(words.map((w) => w.text)).toEqual(["hi", "there"]);
  });

  it("marks soft-hyphen line breaks", () => {
    const glyphs = extractPageGlyphs({
      page: 0,
      items: [
        { str: "over-", transform: [10, 0, 0, 10, 0, 100], width: 50, height: 10, fontName: "f" },
        { str: "flow",  transform: [10, 0, 0, 10, 0, 80],  width: 40, height: 10, fontName: "f" },
      ],
      getFont: font,
    });
    const words = groupWords(glyphs);
    expect(words[0].softHyphenated).toBe(true);
    expect(words[0].continues).toBe(1);
    expect(words[1].text).toBe("flow");
  });
});
