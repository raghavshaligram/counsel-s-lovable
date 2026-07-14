import { describe, expect, it } from "vitest";
import {
  multiply, invert, apply, decompose, rotation, translation, scale, skew,
  pointInOrientedBox, orientedBoxIntersectsRect, IDENTITY,
} from "@/lib/glyphs/transform";
import type { OrientedBox } from "@/lib/glyphs/types";

describe("transform math", () => {
  it("multiplies to identity round-trip", () => {
    const m = multiply(rotation(0.7), scale(2, 3));
    const inv = invert(m);
    const round = multiply(m, inv);
    for (let i = 0; i < 6; i++) expect(round[i]).toBeCloseTo(IDENTITY[i], 6);
  });

  it("applies a translation", () => {
    const p = apply(translation(5, -3), { x: 1, y: 2 });
    expect(p).toEqual({ x: 6, y: -1 });
  });

  it("decomposes rotation + scale", () => {
    const m = multiply(rotation(Math.PI / 6), scale(2, 3));
    const d = decompose(m);
    expect(d.rotation).toBeCloseTo(Math.PI / 6, 5);
    expect(d.scaleX).toBeCloseTo(2, 5);
    expect(d.scaleY).toBeCloseTo(3, 5);
    expect(d.skewX).toBeCloseTo(0, 5);
  });

  it("decomposes a shear as skewX", () => {
    const m = multiply(rotation(0.2), skew(0.25, 0));
    const d = decompose(m);
    expect(d.rotation).toBeCloseTo(0.2, 5);
    expect(d.skewX).toBeCloseTo(0.25, 4);
  });
});

describe("oriented box tests", () => {
  // Unit square rotated 30° CCW about origin.
  const theta = Math.PI / 6;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const rot = (x: number, y: number) => ({ x: cos * x - sin * y, y: sin * x + cos * y });
  const box: OrientedBox = {
    corners: [rot(0, 1), rot(1, 1), rot(1, 0), rot(0, 0)],
  };

  it("accepts interior points", () => {
    expect(pointInOrientedBox(rot(0.5, 0.5), box)).toBe(true);
  });
  it("rejects exterior points", () => {
    expect(pointInOrientedBox({ x: 2, y: 0 }, box)).toBe(false);
  });
  it("SAT: overlapping rect intersects", () => {
    expect(orientedBoxIntersectsRect(box, { x: 0, y: 0, w: 0.4, h: 0.4 })).toBe(true);
  });
  it("SAT: disjoint rect does not intersect", () => {
    expect(orientedBoxIntersectsRect(box, { x: 5, y: 5, w: 1, h: 1 })).toBe(false);
  });
});
