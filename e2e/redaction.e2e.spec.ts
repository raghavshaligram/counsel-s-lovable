import { test, expect } from "@playwright/test";

/**
 * End-to-end regression test for the redaction pipeline.
 *
 * WHY: tests/redaction-gate.test.ts runs in Node — it cannot load Web
 * Workers, canvas, or pdf.js rendering, which are exactly the pieces
 * that broke in the "text still traceable after redaction" regression.
 * This test drives the REAL browser chain against the running dev
 * server so a future regression in rasterize / gate / worker wiring
 * can never ship silently.
 *
 * WHAT: builds a fixture PDF that carries the same secret in FOUR
 * vectors (page text, form field /V, annotation /Contents, Info-dict
 * metadata), runs rasterize (via the same worker wrapper the export
 * dialog uses) → enforceRedactionGate, then independently re-extracts
 * text from the FINAL bytes with a fresh pdf.js document.
 *
 * Pass conditions (either is acceptable — both mean no leak ships):
 *   "clean"   — gate returned bytes AND fresh re-extraction finds nothing
 *   "blocked" — gate refused to release bytes (RedactionGateError)
 *
 * Fail condition (the exact class of regression this guards against):
 *   "leaked"  — gate returned bytes BUT the secret is still recoverable
 *               from raw bytes or the text layer of the exported PDF.
 */

const HARNESS_URL = "/src/lib/test/redaction-e2e-harness.ts";

test.describe("redaction end-to-end (browser chain)", () => {
  test("mixed page-text + side-channel selection: no leak ships", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Vite serves the harness + all editor/worker modules at :8080.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ url: HARNESS_URL, type: "module" });

    await page.waitForFunction(
      () => typeof (window as unknown as { __runMixedRedactionE2E?: unknown }).__runMixedRedactionE2E === "function",
      { timeout: 30_000 },
    );

    const probe = (await page.evaluate(async () => {
      const fn = (window as unknown as { __runMixedRedactionE2E: () => Promise<unknown> })
        .__runMixedRedactionE2E;
      return fn();
    })) as {
      secret: string;
      name: string;
      outcome: "clean" | "blocked" | "leaked";
      secretInRawBytes?: boolean;
      secretInExtractedText?: boolean;
      perPageText?: string[];
      vectors?: Record<string, number>;
      outputBytes?: number;
      rasterizedPages?: number[];
      blockedMessage?: string;
      blockedVectors?: Record<string, number>;
    };

    // Log for CI visibility.
    // eslint-disable-next-line no-console
    console.log("[redaction-e2e]", JSON.stringify(probe, null, 2));

    // The single hard invariant: leaky bytes must NEVER be delivered.
    expect(
      probe.outcome,
      probe.outcome === "leaked"
        ? `LEAK: gate returned bytes but secret still recoverable. raw=${probe.secretInRawBytes} text=${probe.secretInExtractedText} pages=${JSON.stringify(probe.perPageText)}`
        : "unreachable",
    ).not.toBe("leaked");

    // Prefer the clean outcome — surface a soft signal when the pipeline
    // only survives by way of the gate blocking. Not a hard failure: the
    // user is safe either way, but pipeline health is worth watching.
    if (probe.outcome === "blocked") {
      // eslint-disable-next-line no-console
      console.warn(
        `[redaction-e2e] gate BLOCKED export — safety preserved but pipeline left leaks: ${
          probe.blockedMessage
        } vectors=${JSON.stringify(probe.blockedVectors)}`,
      );
    } else {
      // outcome === "clean"
      expect(probe.rasterizedPages).toContain(0);
      expect(probe.outputBytes ?? 0).toBeGreaterThan(1024);
      expect(probe.vectors?.formField ?? -1).toBe(0);
      expect(probe.vectors?.annotation ?? -1).toBe(0);
      expect(probe.vectors?.rawStream ?? -1).toBe(0);
    }

    // A page/module error in our redaction modules would indicate a
    // broken worker chain — fatal. Ignore unrelated dev-mode noise from
    // the landing route (hydration diffs from `data-tsd-source` markers).
    const relevantErrors = consoleErrors.filter(
      (e) => /redact|sanitize|verify|rasterize|pdfjs|pdf-lib|worker/i.test(e),
    );
    expect(
      relevantErrors,
      `redaction-module console errors:\n${relevantErrors.join("\n")}`,
    ).toEqual([]);
  });

  test("fragmented-token selection: whole value redacted, no fragment survives", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ url: HARNESS_URL, type: "module" });

    await page.waitForFunction(
      () => typeof (window as unknown as { __runFragmentedRedactionE2E?: unknown }).__runFragmentedRedactionE2E === "function",
      { timeout: 30_000 },
    );

    const probe = (await page.evaluate(async () => {
      const fn = (window as unknown as { __runFragmentedRedactionE2E: () => Promise<unknown> })
        .__runFragmentedRedactionE2E;
      return fn();
    })) as {
      fullValue: string;
      leadingFragment: string;
      trailingFragment: string;
      outcome: "clean" | "blocked" | "leaked";
      rectsCoveredAllFragments: boolean;
      detectionRectCount: number;
      extractedText?: string;
      leadingSurvived?: boolean;
      trailingSurvived?: boolean;
      fullSurvived?: boolean;
      blockedMessage?: string;
    };

    // eslint-disable-next-line no-console
    console.log("[redaction-e2e:frag]", JSON.stringify(probe, null, 2));

    expect(
      probe.outcome,
      probe.outcome === "leaked"
        ? `LEAK: fragment survived. leading=${probe.leadingSurvived} trailing=${probe.trailingSurvived} full=${probe.fullSurvived} text=${probe.extractedText}`
        : "unreachable",
    ).not.toBe("leaked");

    // Token expansion must have produced at least one rect per fragment
    // item. A single rect = the middle-fragment-only leak we're guarding
    // against. Only enforce when the gate didn't block (blocking is also
    // a safe outcome but tells us nothing about expansion).
    if (probe.outcome === "clean") {
      expect(
        probe.rectsCoveredAllFragments,
        `token expansion did not fire: only ${probe.detectionRectCount} rect(s) for a 3-fragment value`,
      ).toBe(true);
    }

    const relevantErrors = consoleErrors.filter(
      (e) => /redact|sanitize|verify|rasterize|pdfjs|pdf-lib|worker/i.test(e),
    );
    expect(
      relevantErrors,
      `redaction-module console errors:\n${relevantErrors.join("\n")}`,
    ).toEqual([]);
  });
});

