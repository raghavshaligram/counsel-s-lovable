/**
 * Regression guard: exhibit labelling + ToC mapping.
 *
 * The exhibit binder is legal-critical: the ToC must match the labels
 * stamped on the underlying documents. We test the pure labelling +
 * title-cleanup helpers here. The full PDF assembly is exercised end
 * to end by the workspace export path.
 */
import { describe, it, expect } from "vitest";
import { exhibitLabel, cleanExhibitTitle } from "@/lib/batch/ops/exhibit-binder";

describe("exhibitLabel — A..Z then AA..AZ", () => {
  it("yields A, B, C for indexes 0, 1, 2 in letters scheme", () => {
    expect(exhibitLabel(0, "letters")).toBe("A");
    expect(exhibitLabel(1, "letters")).toBe("B");
    expect(exhibitLabel(25, "letters")).toBe("Z");
  });
  it("rolls over to AA, AB, AZ, BA after Z", () => {
    expect(exhibitLabel(26, "letters")).toBe("AA");
    expect(exhibitLabel(27, "letters")).toBe("AB");
    expect(exhibitLabel(51, "letters")).toBe("AZ");
    expect(exhibitLabel(52, "letters")).toBe("BA");
  });
  it("numbers scheme is 1-based", () => {
    expect(exhibitLabel(0, "numbers")).toBe("1");
    expect(exhibitLabel(9, "numbers")).toBe("10");
  });
  it("labels are unique across the first 100 exhibits", () => {
    const labels = new Set<string>();
    for (let i = 0; i < 100; i++) labels.add(exhibitLabel(i, "letters"));
    expect(labels.size).toBe(100);
  });
});

describe("cleanExhibitTitle — filename cleanup", () => {
  it("strips leading index and exhibit token", () => {
    const out = cleanExhibitTitle("04_ExhibitC_Financials.pdf");
    expect(out.toLowerCase()).toContain("financials");
    expect(out.toLowerCase()).not.toContain("exhibitc");
  });
  it("prefers an explicit title when given", () => {
    const out = cleanExhibitTitle("anything.pdf", "Settlement Agreement");
    expect(out).toBe("Settlement Agreement");
  });
  it("falls back to a humanised filename when nothing else is usable", () => {
    const out = cleanExhibitTitle("invoice_april_2024.pdf");
    expect(out.toLowerCase()).toContain("invoice");
    expect(out.toLowerCase()).toContain("april");
  });
});
