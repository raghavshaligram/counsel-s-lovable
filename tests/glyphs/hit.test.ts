import { describe, expect, it } from "vitest";
import { extractPageGlyphs } from "@/lib/glyphs/extract";
import { glyphAtPoint, glyphsInRect, rangeBetween } from "@/lib/glyphs/hit";

const font = () => ({ ascent: 0.75, descent: 0.25, unitsPerEm: 1000 });

describe("hit testing", () => {
  const glyphs = extractPageGlyphs({
    page: 0,
    items: [{ str: "abcde", transform: [10, 0, 0, 10, 0, 100], width: 50, height: 10, fontName: "f" }],
    getFont: font,
  });

  it("picks the glyph under a point", () => {
    const g = glyphAtPoint(glyphs, { x: 25, y: 103 });
    expect(g?.char).toBe("c");
  });

  it("returns glyphs inside a drag rect", () => {
    const hits = glyphsInRect(glyphs, { x: 12, y: 95, w: 20, h: 15 });
    expect(hits.map((g) => g.char).join("")).toBe("bcd");
  });

  it("finds rotated glyphs via SAT", () => {
    // 90° CCW: characters march up the y axis.
    const rotated = extractPageGlyphs({
      page: 0,
      items: [{ str: "abc", transform: [0, 10, -10, 0, 100, 0], width: 30, height: 10, fontName: "f" }],
      getFont: font,
    });
    const g = glyphAtPoint(rotated, { x: 97, y: 15 });
    expect(g?.char).toBe("b");
  });

  it("rangeBetween returns a closed inclusive slice", () => {
    const slice = rangeBetween(glyphs, glyphs[1].id, glyphs[3].id);
    expect(slice.map((g) => g.char).join("")).toBe("bcd");
  });
});
