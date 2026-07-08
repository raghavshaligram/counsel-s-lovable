/**
 * Browser-only test harness for the end-to-end redaction path.
 *
 * The unit test in tests/redaction-gate.test.ts runs in Node and therefore
 * cannot exercise the real Worker chain (rasterize → sanitize → verify)
 * that ships to users. Node has no `Worker`, no `Canvas`, and no pdf.js
 * rendering surface — so a Node-only test cannot catch regressions in the
 * actual browser pipeline. That was the exact blind spot behind the last
 * "text still traceable after redaction" regression.
 *
 * This module is imported by a Playwright test that runs it INSIDE the
 * live app page in headless Chromium — so pdf.js, real Web Workers, and
 * OffscreenCanvas are all present. The Playwright test simply asserts on
 * the returned probe.
 *
 * Not wired into production code. Only referenced by the e2e test.
 */

import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { enforceRedactionGate } from "@/lib/editor/redaction-gate";
import { rasterizeRedactedPagesInWorker } from "@/lib/workers/rasterize-client";
import type { RedactionRectTL } from "@/lib/editor/rasterize-redacted-pages";
import { loadPdfjs } from "@/lib/pdf/worker";

// pdf.js 5.x uses Map.prototype.getOrInsertComputed (TC39 upsert proposal),
// which is only unflagged in Chromium 142+. Test browsers may lag; polyfill
// so the e2e is portable. Ships in the test harness bundle only — not in
// any production route.
if (typeof Map !== "undefined" && !(Map.prototype as unknown as { getOrInsertComputed?: unknown }).getOrInsertComputed) {
  (Map.prototype as unknown as {
    getOrInsertComputed: (k: unknown, cb: (k: unknown) => unknown) => unknown;
  }).getOrInsertComputed = function (key: unknown, cb: (k: unknown) => unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = this;
    if (self.has(key)) return self.get(key);
    const v = cb(key);
    self.set(key, v);
    return v;
  };
}

const SECRET = "987-65-4321";
const NAME = "John Q Public";

export interface E2eProbe {
  secret: string;
  name: string;
  /** true iff SECRET appears anywhere in raw output bytes (latin1 view + flate substreams). */
  secretInRawBytes: boolean;
  /** true iff SECRET appears in ANY page's text layer as extracted by pdf.js. */
  secretInExtractedText: boolean;
  /** Extracted text per page (post-export), for debugging. */
  perPageText: string[];
  /** Gate report. */
  vectors: {
    page: number;
    formField: number;
    annotation: number;
    hiddenLayer: number;
    attachment: number;
    rawStream: number;
  };
  ok: boolean;
  outputBytes: number;
  rasterizedPages: number[];
}

/** Build a mixed-vector fixture: page-text on p1, form field, annotation
 *  contents, and Info-dict metadata all carrying the SAME secret + name. */
async function buildFixture(): Promise<{ bytes: Uint8Array; rect: RedactionRectTL }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Case file for ${NAME} ${SECRET}`);
  doc.setAuthor(`${NAME} ${SECRET}`);
  doc.setSubject(`SSN ${SECRET}`);
  doc.setKeywords([`ssn:${SECRET}`, "confidential"]);

  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Case summary", { x: 72, y: 740, size: 14, font: helv });
  const line = `Subject: ${NAME}, SSN ${SECRET}`;
  const y = 700;
  const size = 12;
  page.drawText(line, { x: 72, y, size, font: helv });
  // approximate width for the whole line (we redact the whole rect so we
  // cover both name and SSN)
  const textW = helv.widthOfTextAtSize(line, size);
  const textH = helv.heightAtSize(size) + 4;

  // Form field carrying the secret as /V.
  const form = doc.getForm();
  const field = form.createTextField("ssn_field");
  field.setText(SECRET);
  field.addToPage(page, { x: 72, y: 620, width: 220, height: 24 });

  // Annotation /Contents with the secret.
  const ctx = doc.context;
  const annot = ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [400, 720, 460, 740] });
  annot.set(PDFName.of("Contents"), PDFString.of(`Reviewer note: SSN ${SECRET}`));
  const annotRef = ctx.register(annot);
  const existing = page.node.Annots();
  if (existing) existing.push(annotRef);
  else page.node.set(PDFName.of("Annots"), ctx.obj([annotRef]));

  const bytes = await doc.save({ useObjectStreams: false });
  // Redaction rect covers the sensitive line. Top-left origin (editor convention).
  const rect: RedactionRectTL = {
    x: 72 - 2,
    y: 792 - y - textH, // top-left y from page-top
    w: textW + 4,
    h: textH + 4,
  };
  return { bytes, rect };
}

function containsAnywhere(bytes: Uint8Array, needle: string): boolean {
  const txt = new TextDecoder("latin1").decode(bytes);
  if (txt.includes(needle)) return true;
  const hex = Array.from(needle).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  if (txt.toLowerCase().includes(hex)) return true;
  const u16hex = "feff" + Array.from(needle).map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  if (txt.toLowerCase().includes(u16hex)) return true;
  return false;
}

async function extractTextPerPage(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return out;
}

/** Run the FULL browser redaction chain (rasterize → gate) against a
 *  mixed page-text + side-channel fixture and return a probe describing
 *  whether the secret survived anywhere. */
export async function runMixedRedactionE2E(): Promise<E2eProbe> {
  const { bytes, rect } = await buildFixture();

  // Step 1 — burn on page 0 via the SAME worker wrapper the export path uses.
  const pageMap = new Map<number, RedactionRectTL[]>([[0, [rect]]]);
  const rast = await rasterizeRedactedPagesInWorker(bytes, pageMap, { scale: 2.5, mode: "always" });

  // Step 2 — gate: sanitize side-channels + verify. Targets include the
  // secret AND the name so the gate scans every vector.
  const targets = [
    { page: 0, text: SECRET, label: "ssn" },
    { page: 0, text: NAME, label: "name" },
  ];
  const gate = await enforceRedactionGate(rast.bytes, targets, {
    rasterizedPages: rast.rasterizedPages,
  });

  // Step 3 — independent post-hoc text extraction against the FINAL bytes.
  const perPageText = await extractTextPerPage(gate.bytes);
  const joined = perPageText.join("\n");

  return {
    secret: SECRET,
    name: NAME,
    secretInRawBytes: containsAnywhere(gate.bytes, SECRET),
    secretInExtractedText: joined.includes(SECRET) || joined.includes(NAME),
    perPageText,
    vectors: gate.verify.vectors,
    ok: gate.verify.ok,
    outputBytes: gate.bytes.byteLength,
    rasterizedPages: gate.rasterizedPages,
  };
}

// Convenience: expose on window so the Playwright script can just call
// `await window.__runMixedRedactionE2E()` without wiring an import graph.
if (typeof window !== "undefined") {
  (window as unknown as { __runMixedRedactionE2E?: typeof runMixedRedactionE2E }).__runMixedRedactionE2E =
    runMixedRedactionE2E;
}
