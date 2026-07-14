import { describe, expect, it } from "vitest";
import { normalizePsName } from "@/lib/fonts/normalize";

describe("normalizePsName", () => {
  const cases: Array<[string, string, number, boolean]> = [
    ["ArialMT",                       "arial",           400, false],
    ["Arial-BoldMT",                  "arial",           700, false],
    ["ABCDEF+ArialMT",                "arial",           400, false],
    ["HelveticaNeueLTStd-Roman",      "helveticaneue",   400, false],
    ["TimesNewRomanPSMT",             "timesnewroman",   400, false],
    ["TimesNewRomanPS-BoldItalicMT",  "timesnewroman",   700, true],
    ["Calibri-Light",                 "calibri",         300, false],
    ["SegoeUI-SemiboldItalic",        "segoeui",         600, true],
    ["AptosDisplay-Bold",             "aptosdisplay",    700, false],
    ["Courier-Oblique",               "courier",         400, true],
    ["MyriadPro-BoldIt",              "myriadpro",       700, true],
  ];
  for (const [input, base, weight, italic] of cases) {
    it(`normalizes ${input}`, () => {
      const n = normalizePsName(input);
      expect(n.base).toBe(base);
      expect(n.weight).toBe(weight);
      expect(n.italic).toBe(italic);
    });
  }

  it("returns empty base for empty input", () => {
    const n = normalizePsName("");
    expect(n.base).toBe("");
    expect(n.weight).toBe(400);
    expect(n.italic).toBe(false);
  });

  it("returns empty base for null input", () => {
    const n = normalizePsName(null);
    expect(n.base).toBe("");
  });
});
