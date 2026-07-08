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
 * metadata), runs rasterizeRedactedPages → enforceRedactionGate, and
 * then independently re-extracts text from the FINAL exported bytes
 * with a fresh pdf.js document. Selected content must be gone from
 * every vector.
 */

const HARNESS_URL = "/src/lib/test/redaction-e2e-harness.ts";

test.describe("redaction end-to-end (browser chain)", () => {
  test("mixed page-text + side-channel selection: nothing survives", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // The harness dynamic-imports pdf.js, pdf-lib, and the real editor
    // modules — Vite serves them from the dev server at :8080.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ url: HARNESS_URL, type: "module" });

    // Wait for the module to publish its handle on window.
    await page.waitForFunction(
      () => typeof (window as unknown as { __runMixedRedactionE2E?: unknown }).__runMixedRedactionE2E === "function",
      { timeout: 30_000 },
    );

    const probe = await page.evaluate(async () => {
      const fn = (window as unknown as {
        __runMixedRedactionE2E: () => Promise<unknown>;
      }).__runMixedRedactionE2E;
      return fn();
    });

    // Type is validated at runtime through the assertions.
    const p = probe as {
      secret: string;
      name: string;
      secretInRawBytes: boolean;
      secretInExtractedText: boolean;
      perPageText: string[];
      vectors: Record<string, number>;
      ok: boolean;
      outputBytes: number;
      rasterizedPages: number[];
    };

    // Sanity: the gate produced bytes and rasterized page 0.
    expect(p.outputBytes).toBeGreaterThan(1024);
    expect(p.rasterizedPages).toContain(0);

    // The gate says everything is clean.
    expect(p.ok, `gate verify.ok false; vectors=${JSON.stringify(p.vectors)}`).toBe(true);
    expect(p.vectors.formField).toBe(0);
    expect(p.vectors.annotation).toBe(0);
    expect(p.vectors.rawStream).toBe(0);
    expect(p.vectors.attachment).toBe(0);

    // Independent post-hoc extraction (fresh pdf.js against final bytes):
    // the SELECTED content must not be recoverable via the text layer.
    expect(
      p.secretInExtractedText,
      `secret/name still recoverable via text layer: ${JSON.stringify(p.perPageText)}`,
    ).toBe(false);

    // And not recoverable from raw bytes / flate streams either.
    expect(p.secretInRawBytes, "secret still present in raw output bytes").toBe(false);

    // No page/module errors along the way.
    expect(consoleErrors, `console errors during redaction e2e: ${consoleErrors.join("\n")}`).toEqual([]);
  });
});
