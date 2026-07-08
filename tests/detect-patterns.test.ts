/**
 * Regression guard: structured PII regex contract.
 *
 * detect-pii.ts ships the patterns used to flag SSN / card / email /
 * phone / IBAN / IP / date in document text. If these regexes silently
 * drift the detection panel will start under-reporting in production
 * and a leak can ship. These tests fail loudly on any drift.
 */
import { describe, it, expect } from "vitest";
import { __testComputeMeasuredSpanBox, __testResetMeasureContext, PATTERNS } from "@/lib/pdf/detect-pii";

function find(category: string, input: string): string | null {
  const p = PATTERNS.find((x) => x.category === category);
  if (!p) throw new Error(`pattern ${category} missing — detect-pii contract broken`);
  // Patterns are single-match in the module; we wrap with `g` for find-all here.
  const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
  const m = re.exec(input);
  return m ? m[0] : null;
}

describe("detect-pii PATTERNS — structured data contract", () => {
  it("flags an SSN", () => {
    expect(find("ssn", "DOB on file, SSN 123-45-6789 confirmed.")).toBe("123-45-6789");
  });
  it("flags an email", () => {
    expect(find("email", "Contact counsel at Sarah.Kline@acme-law.example.")).toBe(
      "Sarah.Kline@acme-law.example",
    );
  });
  it("flags a phone number (multiple formats)", () => {
    expect(find("phone", "Call (415) 555-0142 to confirm.")).toMatch(/415.{0,3}555.{0,3}0142/);
    expect(find("phone", "Direct: +1 415.555.0199")).toMatch(/415\.555\.0199/);
  });
  it("flags a 16-digit card with space groups", () => {
    expect(find("creditCard", "Card on file: 4111 1111 1111 1111.")).toBe("4111 1111 1111 1111");
  });
  it("flags a 16-digit card with dash groups", () => {
    expect(find("creditCard", "Card 4111-1111-1111-1111.")).toBe("4111-1111-1111-1111");
  });
  it("flags an IBAN", () => {
    expect(find("iban", "Wire to DE89 3704 0044 0532 0130 00 by Friday.")).toBe(
      "DE89 3704 0044 0532 0130 00",
    );
  });
  it("flags an IPv4 address", () => {
    expect(find("ipAddress", "Logged from 192.168.10.42 at 09:14.")).toBe("192.168.10.42");
  });
  it("flags a date", () => {
    expect(find("date", "Filed 03/14/2024 and served the same day.")).toBe("03/14/2024");
  });
  it("does NOT flag obvious non-SSN strings", () => {
    expect(find("ssn", "Order #12-34 from 2024.")).toBeNull();
  });
});

describe("detect-pii geometry — measured substring spans", () => {
  it("places a structured PII box on the true leading edge after a narrow label prefix", () => {
    const originalDocument = globalThis.document;
    __testResetMeasureContext();
    const str = "Client SSN (test data): 652-77-1009";
    const widths = new Map<string, number>([
      ["Client SSN (test data): ", 102.26],
      ["652-77-1009", 61.16],
      [str, 163.42],
    ]);
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          font: "",
          measureText: (text: string) => ({
            width: widths.get(text) ?? text.length * 4,
          }),
        }),
      }),
    };

    try {
      const matchStart = str.indexOf("652-77-1009");
      const wholeItemWidth = 163.42;
      const box = __testComputeMeasuredSpanBox(
        {
          str,
          x0: 72,
          charW: wholeItemWidth / str.length,
          fontName: "Helvetica",
          fontHeight: 10,
        },
        matchStart,
        "652-77-1009".length,
      );

      expect(box).not.toBeNull();
      expect(box!.subX).toBeCloseTo(174.26, 2);
      expect(box!.subW).toBeCloseTo(61.16, 2);
      // Old average-width extrapolation overshot the real leading edge by
      // more than one 10pt Helvetica digit, exposing the first SSN digit.
      expect(box!.avgSubX - box!.subX).toBeGreaterThan(5.56);
    } finally {
      __testResetMeasureContext();
      if (originalDocument === undefined) {
        delete (globalThis as unknown as { document?: unknown }).document;
      } else {
        globalThis.document = originalDocument;
      }
    }
  });
});
