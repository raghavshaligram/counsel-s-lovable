import { describe, expect, it } from "vitest";
import { hullOfRects, emBoxOriented, boxAabb } from "@/lib/glyphs/bbox";

describe("hullOfRects", () => {
  it("returns zero rect for empty", () => {
    expect(hullOfRects([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
  it("computes the hull", () => {
    const h = hullOfRects([
      { x: 0, y: 0, w: 2, h: 2 },
      { x: 3, y: 1, w: 1, h: 4 },
    ]);
    expect(h).toEqual({ x: 0, y: 0, w: 4, h: 5 });
  });
});

describe("emBoxOriented", () => {
  it("wraps all four corners in its AABB", () => {
    // 90° rotation: local x → device y.
    const m = [0, 1, -1, 0, 10, 20] as [number, number, number, number, number, number];
    const box = emBoxOriented(m, 5, 3, 1);
    const a = boxAabb(box);
    for (const c of box.corners) {
      expect(c.x).toBeGreaterThanOrEqual(a.x - 1e-9);
      expect(c.x).toBeLessThanOrEqual(a.x + a.w + 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(a.y - 1e-9);
      expect(c.y).toBeLessThanOrEqual(a.y + a.h + 1e-9);
    }
  });
});
