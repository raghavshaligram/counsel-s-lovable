// Standalone entry for the Playwright redaction e2e. Importing the harness
// for its side effects attaches __runMixedRedactionE2E / __runFragmentedRedactionE2E
// (and the result-reporting wrappers) to `window`. This page is built with a
// plain Vite build and served via `vite preview`, so there is NO dev HMR
// client, NO on-the-fly dependency optimization reload, and pdf.js's worker is
// bundled as a real asset — eliminating the dev-server flakiness (spurious
// full-page reloads, pdf.js "fake worker" 404 fallback) that made the e2e race
// a navigation. Not part of the shipping app.
import "@/lib/test/redaction-e2e-harness";
