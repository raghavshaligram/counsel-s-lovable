/**
 * Regression guard: name detection covers ALL-CAPS headers with strong
 * context signals and labelled fields ("Client Name: John Smith"), while
 * still rejecting genuine section headings.
 */
import { describe, it, expect } from "vitest";
import { __testMatchAllCategories } from "@/lib/pdf/detect-pii";

function names(str: string): string[] {
  return __testMatchAllCategories(str)
    .filter((h) => h.category === "name")
    .map((h) => h.text);
}

describe("detect-pii name regex — ALL-CAPS + labelled fields", () => {
  it("catches an ALL-CAPS name in a confidential header with SSN context", () => {
    const s = "CONFIDENTIAL CLIENT FILE – JOHN SMITH – SSN 123-45-6789";
    expect(names(s)).toContain("JOHN SMITH");
  });

  it("catches a title-case name after a 'Client Name:' label", () => {
    expect(names("Client Name: John Smith")).toContain("John Smith");
  });

  it("does NOT flag EXECUTIVE SUMMARY as a name", () => {
    expect(names("EXECUTIVE SUMMARY")).toEqual([]);
  });

  it("does NOT flag UNITED STATES DISTRICT COURT as a name", () => {
    expect(names("UNITED STATES DISTRICT COURT")).toEqual([]);
  });
});
