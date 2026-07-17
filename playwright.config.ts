import { defineConfig } from "@playwright/test";

/**
 * Playwright config for PDFMacro end-to-end tests.
 *
 * Goal: exercise code paths that Node vitest can't — Web Workers,
 * pdf.js rendering, canvas/OffscreenCanvas — inside real headless
 * Chromium against the running Vite dev server. This is where redaction
 * regressions actually hide.
 *
 * The dev server on :8080 is expected to already be running in CI/sandbox;
 * we intentionally do NOT set `webServer` here because the harness restarts
 * Vite around package installs and a competing spawn would conflict.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8080",
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // The sandbox ships a pre-installed Chromium at a fixed path; the
        // Playwright NPM package's expected browser revision may not match.
        // Fall back to the pinned pre-installed binary when present.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
});
