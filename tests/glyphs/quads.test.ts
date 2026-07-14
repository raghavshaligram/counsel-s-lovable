import { describe, expect, it } from "vitest";
import { extractPageGlyphs } from "@/lib/glyphs/extract";
import { selectionQuads } from "@/lib/glyphs/quads";
import { orientedAabb } from "@/lib/glyphs/transform";

const font = () => ({ ascent: 0.75, descent: 0.25, unitsPerEm: 1000 });

describe("selectionQuads", () => {
  it("emits one oriented quad per baseline bucket", () => {
    const glyphs = extractPageGlyphs({
      page: 0,
      items: [
        { str: "line1", transform: [10, 0, 0, 10, 0, 100], width: 50, height: 10, fontName: "f" },
        { str: "line2", transform: [10, 0, 0, 10, 0, 80],  width: 50, height: 10, fontName: "f" },
      ],
      getFont: font,
    });
    const quads = selectionQuads(glyphs, {
      page: 0,
      anchorId: glyphs[0].id,
      focusId: glyphs[glyphs.length - 1].id,
    });
    expect(quads).toHaveLength(2);
  });

  it("keeps a single quad across a rotated block", () => {
    const glyphs = extractPageGlyphs({
      page: 0,
      items: [{ str: "abcde", transform: [0, 10, -10, 0, 100, 0], width: 50, height: 10, fontName: "f" }],
      getFont: font,
    });
    const quads = selectionQuads(glyphs, {
      page: 0, anchorId: glyphs[0].id, focusId: glyphs[4].id,
    });
    expect(quads).toHaveLength(1);
    // Quad AABB should be ~10 wide (glyph size) × 50 tall (advance × 5) for 90° rotation.
    const a = orientedAabb(quads[0]);
    expect(a.h).toBeGreaterThan(a.w);
  });

  it("quad height ≈ ascent + descent, no ad-hoc padding", () => {
    const glyphs = extractPageGlyphs({
      page: 0,
      items: [{ str: "abc", transform: [10, 0, 0, 10, 0, 100], width: 30, height: 10, fontName: "f" }],
      getFont: font,
    });
    const [q] = selectionQuads(glyphs, {
      page: 0, anchorId: glyphs[0].id, focusId: glyphs[2].id,
    });
    const a = orientedAabb(q);
    // fontSize = 10, ascent 0.75 + descent 0.25 → h ≈ 10
    expect(a.h).toBeCloseTo(10, 5);
  });
});
