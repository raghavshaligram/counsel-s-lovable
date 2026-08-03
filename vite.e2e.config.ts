// Standalone Vite build/preview config for the Playwright redaction e2e.
//
// WHY NOT THE DEV SERVER: driving the redaction chain against `vite dev`
// (the app's SSR/HMR dev server) was flaky — the Vite dev client issued
// spurious full-page reloads (HMR reconnect + on-the-fly dep optimization)
// and pdf.js fell back to a "fake worker" on a 404, all of which tore down or
// stalled the run mid-flight ("Execution context was destroyed, most likely
// because of a navigation"). None of that exists in a production build.
//
// This config builds ONLY a tiny standalone page (e2e/harness/index.html)
// that imports the e2e harness, which pulls in the REAL production redaction
// modules (rasterize → sanitize → verify → pdf.js) and their bundled workers.
// `vite preview` then serves the static output with no HMR and no dev
// transforms — deterministic, and closer to what actually ships. It does not
// touch or rebuild the app itself.
import { defineConfig } from "vite";
import path from "node:path";

const root = path.resolve(process.cwd(), "e2e/harness");

export default defineConfig({
  root,
  base: "/",
  resolve: {
    alias: {
      // Mirror the app's "@" -> src alias so the harness can import the real
      // production redaction modules.
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  // rasterize.worker + automation worker rely on dynamic import(), which needs
  // ES-module worker output (matches the app's vite.config.ts).
  worker: { format: "es" },
  build: {
    outDir: path.resolve(process.cwd(), "e2e/harness-dist"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: { input: path.resolve(root, "index.html") },
  },
  preview: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
  },
});
