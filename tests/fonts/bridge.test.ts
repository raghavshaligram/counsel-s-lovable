import { describe, expect, it } from "vitest";
import { resolveToFontKey } from "@/lib/fonts/bridge";

describe("resolveToFontKey", () => {
  it("Times New Roman bold italic → tinos, weight 700, italic", () => {
    const r = resolveToFontKey({ postscriptName: "TimesNewRomanPS-BoldItalicMT" });
    expect(r.key).toBe("tinos");
    expect(r.weight).toBe(700);
    expect(r.italic).toBe(true);
    expect(r.bold).toBe(true);
    expect(r.matched).toBe(true);
    expect(r.fontFamily.toLowerCase()).toContain("vaulttinos");
  });

  it("Calibri → carlito", () => {
    const r = resolveToFontKey({ pdfFamily: "Calibri" });
    expect(r.key).toBe("carlito");
  });

  it("Arial subset prefix → arimo", () => {
    const r = resolveToFontKey({ postscriptName: "ABCDEF+ArialMT" });
    expect(r.key).toBe("arimo");
  });

  it("Consolas → cousine", () => {
    const r = resolveToFontKey({ postscriptName: "Consolas-Bold" });
    expect(r.key).toBe("cousine");
    expect(r.weight).toBe(700);
  });

  it("unknown serif hint → tinos and marked approximate", () => {
    const r = resolveToFontKey({ cssFamily: "MadeUpBook, serif" });
    expect(r.key).toBe("tinos");
    expect(r.approximate).toBe(true);
    expect(r.matched).toBe(false);
  });

  it("Garamond → tinos and approximate (no metric twin)", () => {
    const r = resolveToFontKey({ pdfFamily: "Garamond" });
    expect(r.key).toBe("tinos");
    expect(r.approximate).toBe(true);
  });



  it("descriptor slot: TimesNewRomanPSMT → tinos", () => {
    const r = resolveToFontKey({ descriptor: "TimesNewRomanPSMT" });
    expect(r.key).toBe("tinos");
    expect(r.matched).toBe(true);
  });
});

