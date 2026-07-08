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

    // A page/module error would indicate a broken worker chain — always fatal.
    expect(consoleErrors, `console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });
});
