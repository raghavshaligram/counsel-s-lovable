import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Regression-guard test suite for legal-critical paths
 * (redaction, sanitize, detection, bates, exhibit binder).
 *
 * Tests run in plain Node — modules that require the browser
 * (pdf.js text extraction, canvas raster verification) are exercised
 * at runtime via the post-export safety gate in
 * `src/components/workspace/export-dialog.tsx`, which blocks the
 * download if any redacted region still yields extractable text.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 30_000,
  },
});
