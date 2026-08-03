import { test, expect, type Page } from "@playwright/test";

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
 *
 * RESULT DELIVERY: we do NOT read the harness result from the return value
 * of a long-lived `page.evaluate()`. The mixed run in particular is slow
 * (rasterize-always → sanitize → verify → re-verify → pdf.js re-extract),
 * and on a slow CI runner a page-level navigation/reload can destroy the
 * execution context AFTER the probe is computed but BEFORE that evaluate
 * resolves — Playwright then throws "Execution context was destroyed, most
 * likely because of a navigation" even though redaction succeeded. Instead
 * we install a `page.exposeFunction` binding BEFORE navigating; the harness
 * pushes the probe through it the instant it resolves, so the result reaches
 * Node regardless of what happens to the page afterward. The run itself is
 * kicked off fire-and-forget so no evaluate is left awaiting across a nav.
 *
 * SERVER: the page under test is a standalone harness page built by
 * vite.e2e.config.ts and served via `vite preview` (a static production
 * build). Its root document imports the harness, so no addScriptTag is
 * needed, and there is no dev HMR client / on-the-fly dep optimization to
 * trigger a full-page reload, and pdf.js's worker is a real bundled asset.
 */

/**
 * Drive one harness entry point and return its probe via a nav-proof
 * binding rather than the evaluate return value.
 */
async function runHarnessViaBinding(
  page: Page,
  runFnName: "__runMixedRedactionE2E" | "__runFragmentedRedactionE2E",
  reportName: string,
): Promise<Record<string, unknown>> {
  let resolveProbe!: (p: Record<string, unknown>) => void;
  const probePromise = new Promise<Record<string, unknown>>((res) => {
    resolveProbe = res;
  });

  // Install the result sink BEFORE navigating. exposeFunction survives
  // navigations, so the binding stays live regardless of what the page does.
  await page.exposeFunction(reportName, (p: Record<string, unknown>) => resolveProbe(p));

  // The preview page's own <script> imports the harness and attaches the run
  // functions to window — no addScriptTag needed.
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.waitForFunction(
    (fnName) => typeof (window as unknown as Record<string, unknown>)[fnName] === "function",
    runFnName,
    { timeout: 30_000 },
  );

  // Fire-and-forget: kick the run off and return immediately. The harness
  // wrapper calls `reportName` with the probe the moment it resolves; on
  // failure we report an error probe so the awaiter below never hangs.
  await page.evaluate(
    ([fnName, repName]) => {
      const w = window as unknown as Record<string, (arg?: unknown) => unknown>;
      void Promise.resolve()
        .then(() => (w[fnName] as () => Promise<unknown>)())
        .catch((e: unknown) => w[repName]({ outcome: "error", error: String(e) }));
    },
    [runFnName, reportName] as const,
  );

  return Promise.race([
    probePromise,
    new Promise<Record<string, unknown>>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out waiting for ${reportName}`)), 90_000),
    ),
  ]);
}

test.describe("redaction end-to-end (browser chain)", () => {
  test("mixed page-text + side-channel selection: no leak ships", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const probe = (await runHarnessViaBinding(page, "__runMixedRedactionE2E", "__reportMixedResult")) as {
      secret: string;
      name: string;
      outcome: "clean" | "blocked" | "leaked" | "error";
      error?: string;
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

    // An "error" outcome means the harness threw before producing a probe —
    // surface it as a real failure with the underlying message.
    expect(probe.outcome, `harness error: ${probe.error}`).not.toBe("error");

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

    const probe = (await runHarnessViaBinding(page, "__runFragmentedRedactionE2E", "__reportFragResult")) as {
      fullValue: string;
      leadingFragment: string;
      trailingFragment: string;
      outcome: "clean" | "blocked" | "leaked" | "error";
      error?: string;
      rectsCoveredAllFragments: boolean;
      detectionRectCount: number;
      beforeText?: string;
      extractedText?: string;
      geometry?: {
        items: Array<{ str: string; x0: number; x1: number; y: number; h: number }>;
        rects: Array<{ x0: number; x1: number; y0: number; y1: number }>;
        leadingItem: { str: string; x0: number; x1: number; y: number; h: number } | null;
        leftmostRectX0: number | null;
        rightmostRectX1: number | null;
        leadingCovered: boolean;
      };
      leadingSurvived?: boolean;
      trailingSurvived?: boolean;
      fullSurvived?: boolean;
      blockedMessage?: string;
    };

    // eslint-disable-next-line no-console
    console.log("[redaction-e2e:frag]", JSON.stringify(probe, null, 2));

    expect(probe.outcome, `harness error: ${probe.error}`).not.toBe("error");

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
      expect(probe.geometry?.leadingCovered, `leading fragment was not fully covered: ${JSON.stringify(probe.geometry)}`).toBe(true);
      expect(
        probe.rectsCoveredAllFragments,
        `token expansion did not cover the full leading-edge value: ${JSON.stringify(probe.geometry)}`,
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
