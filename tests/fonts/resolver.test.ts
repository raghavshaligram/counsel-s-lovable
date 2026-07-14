import { describe, expect, it } from "vitest";
import { resolveFont } from "@/lib/fonts/resolver";

describe("resolveFont", () => {
  it("resolves via descriptor with confidence 1.0", () => {
    const r = resolveFont({ descriptor: "TimesNewRomanPS-BoldItalicMT" });
    expect(r.font.id).toBe("times-new-roman");
    expect(r.weight).toBe(700);
    expect(r.italic).toBe(true);
    expect(r.bold).toBe(true);
    expect(r.source).toBe("descriptor");
    expect(r.confidence).toBe(1.0);
    expect(r.exact).toBe(true);
  });

  it("descriptor beats cssFamily", () => {
    const r = resolveFont({ descriptor: "ArialMT", cssFamily: "Georgia, serif" });
    expect(r.font.id).toBe("arial");
    expect(r.source).toBe("descriptor");
  });

  it("resolves via PostScript name", () => {
    const r = resolveFont({ postscriptName: "HelveticaNeueLTStd-Roman" });
    expect(r.font.id).toBe("helvetica-neue");
    expect(r.source).toBe("postscript");
    expect(r.confidence).toBe(1.0);
  });

  it("resolves via pdfFamily with 0.95 confidence", () => {
    const r = resolveFont({ pdfFamily: "Calibri" });
    expect(r.font.id).toBe("calibri");
    expect(r.source).toBe("pdfFamily");
    expect(r.confidence).toBeCloseTo(0.95);
  });

  it("resolves via cssFamily walking the stack", () => {
    const r = resolveFont({ cssFamily: "'Foobar', 'Segoe UI', sans-serif" });
    expect(r.font.id).toBe("segoe-ui");
    expect(r.source).toBe("cssFamily");
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it("resolves aliases: Palatino → Book Antiqua", () => {
    const r = resolveFont({ pdfFamily: "Palatino" });
    expect(r.font.id).toBe("book-antiqua");
  });

  it("resolves metric twin: Carlito → Calibri", () => {
    const r = resolveFont({ postscriptName: "Carlito-Bold" });
    expect(r.font.id).toBe("calibri");
    expect(r.weight).toBe(700);
  });

  it("falls back to generic sans for unknown family", () => {
    const r = resolveFont({ cssFamily: "CompletelyMadeUpFont" });
    expect(r.font.id).toBe("generic-sans");
    expect(r.exact).toBe(false);
    expect(r.source).toBe("generic");
    expect(r.confidence).toBeCloseTo(0.2);
  });

  it("falls back to generic serif when hinted", () => {
    const r = resolveFont({ cssFamily: "MadeUpBook, serif" });
    expect(r.font.id).toBe("generic-serif");
  });

  it("falls back to generic mono when hinted", () => {
    const r = resolveFont({ cssFamily: "MadeUpMono, monospace" });
    expect(r.font.id).toBe("generic-mono");
  });

  it("honours numeric weight hint", () => {
    const r = resolveFont({ descriptor: "ArialMT", weightHint: 800 });
    expect(r.weight).toBe(800);
    expect(r.bold).toBe(true);
  });

  it("honours italic hint", () => {
    const r = resolveFont({ descriptor: "ArialMT", italicHint: true });
    expect(r.italic).toBe(true);
  });

  it("handles subset prefix", () => {
    const r = resolveFont({ postscriptName: "ABCDEF+TimesNewRomanPSMT" });
    expect(r.font.id).toBe("times-new-roman");
  });

  it("returns empty query as generic sans", () => {
    const r = resolveFont({});
    expect(r.font.id).toBe("generic-sans");
    expect(r.exact).toBe(false);
  });
});
