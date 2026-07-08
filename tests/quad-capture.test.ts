import { describe, it, expect } from "vitest";
import { computeQuads } from "@/lib/editor/quad-capture";
import type { TextItemLite } from "@/lib/editor/quad-capture";

/**
 * Guards the "fragmented number" leak class: pdf.js splits a visible token
 * ("(763) 300-1828", "0781151140428") into multiple adjacent text items,
 * and if the drag rect only comfortably overlaps the MIDDLE fragment, the
 * old computeQuads emitted a quad covering just that middle. The burn then
 * leaves leading/trailing digits visible AND extractable — a real leak.
 *
 * Token expansion must extend the quad's x/x2 across contiguous adjacent
 * fragments (no whitespace, small gap) on the same y-band. Adjacent
 * unrelated words (separated by whitespace or a large gap) must NOT be
 * over-redacted.
 */

// Font-height in points for the whole fixture. Everything else — gaps,
// y-band — is expressed relative to this.
const H = 10;

function item(str: string, x: number, w: number, y = 100): TextItemLite {
  return { x, y, w, h: H, str };
}

describe("computeQuads — token expansion across fragmented text items", () => {
  it("covers the WHOLE fragmented phone number when drag only hits the middle", () => {
    // "(7" + "63) 300-18" + "28" — three items with tiny gaps, no whitespace.
    // Middle fragment sits at x=[12, 42]; leading at [10,12]; trailing at [42,46].
    const items: TextItemLite[] = [
      item("(7", 10, 2),
      item("63) 300-18", 12, 30),
      item("28", 42, 4),
    ];
    // Drag rect comfortably covers only the middle fragment.
    const rect = { x: 14, y: 98, w: 26, h: H + 4 };
    const quads = computeQuads(rect, items);
    expect(quads).toHaveLength(1);
    const q = quads[0];
    // Expanded x should reach the leading fragment's left (x=10) and the
    // trailing fragment's right (x=46). Allow tiny padX cushion (≤1.5pt).
    expect(q.x).toBeLessThanOrEqual(10 + 0.01);
    expect(q.x + q.w).toBeGreaterThanOrEqual(46 - 0.01);
  });

  it("covers the leading character when the hit lands inside one text item", () => {
    // pdf.js can also keep a value in ONE item while the user's drag starts
    // just after the first glyph. The old quad clamped to rect.x, leaving
    // the first digit/letter visible ("0████" or "A████").
    const items: TextItemLite[] = [item("A0781151140428", 10, 56)];
    const rect = { x: 14, y: 98, w: 44, h: H + 4 };
    const quads = computeQuads(rect, items);
    expect(quads).toHaveLength(1);
    expect(quads[0].x).toBeLessThanOrEqual(10 + 0.01);
    expect(quads[0].x + quads[0].w).toBeGreaterThanOrEqual(66 - 0.01);
  });

  it("stops at whitespace — does NOT over-redact the adjacent word", () => {
    // "Name:" + " Jane" — space at start of second item breaks the chain.
    // Drag hits only "Name:" — expansion must not swallow " Jane".
    const items: TextItemLite[] = [
      item("Name:", 10, 20),
      item(" Jane", 30, 18),
    ];
    const rect = { x: 12, y: 98, w: 16, h: H + 4 };
    const quads = computeQuads(rect, items);
    expect(quads).toHaveLength(1);
    // Right edge may cover the inter-item space/pad, but must not reach the
    // first non-space glyph of "Jane" (space consumes 18/5 = 3.6pt).
    expect(quads[0].x + quads[0].w).toBeLessThan(33.6);
  });

  it("stops at a large horizontal gap — does NOT bridge unrelated columns", () => {
    // Two fragments separated by a > 0.5*fontHeight gap simulate two
    // columns of unrelated text.
    const items: TextItemLite[] = [
      item("07", 10, 4),
      item("something-else", 60, 40), // gap = 46 pt, > 5 pt threshold
    ];
    const rect = { x: 11, y: 98, w: 2, h: H + 4 };
    const quads = computeQuads(rect, items);
    expect(quads).toHaveLength(1);
    expect(quads[0].x + quads[0].w).toBeLessThan(60);
  });

  it("expands only on the boundary side that touches the hit", () => {
    // Three fragments: leading + hit + trailing. Drag touches hit and
    // trailing but not leading (leading has whitespace suffix).
    const items: TextItemLite[] = [
      item("prefix ", 10, 10), // trailing space → chain stops here
      item("123-45-", 20, 12),
      item("6789", 32, 8),
    ];
    const rect = { x: 21, y: 98, w: 10, h: H + 4 };
    const quads = computeQuads(rect, items);
    expect(quads).toHaveLength(1);
    const q = quads[0];
    // Right edge crosses into "6789" (through 40).
    expect(q.x + q.w).toBeGreaterThanOrEqual(40 - 0.01);
    // Left edge must NOT swallow "prefix " (ends at x=20, has trailing space).
    // computeQuads clamps to drag.x=21 minus small padX cushion.
    expect(q.x).toBeGreaterThan(20 - 2);
  });
});
