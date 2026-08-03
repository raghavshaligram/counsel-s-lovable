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
  /**
   * "clean"  — gate returned bytes AND independent re-extraction confirms
   *            no vector still carries the secret. This is the pass case.
   * "blocked" — gate refused to return bytes (RedactionGateError). The
   *            user would never receive a leaky file, which is the correct
   *            safety outcome. Test tolerates this.
   * "leaked" — gate RETURNED bytes but our independent re-scan still
   *            recovers the secret. This is the regression case the last
   *            "text still traceable" bug produced — must FAIL loudly.
   */
  outcome: "clean" | "blocked" | "leaked";
  /** Present when outcome !== "blocked". */
  secretInRawBytes?: boolean;
  secretInExtractedText?: boolean;
  perPageText?: string[];
  vectors?: {
    page: number;
    formField: number;
    annotation: number;
    hiddenLayer: number;
    attachment: number;
    rawStream: number;
  };
  outputBytes?: number;
  rasterizedPages?: number[];
  /** Present when outcome === "blocked". */
  blockedMessage?: string;
  blockedVectors?: Record<string, number>;
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
  const doc = await pdfjs.getDocument({ data: bytes.slice(), enableXfa: true, useSystemFonts: true }).promise;
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

  let gate;
  try {
    gate = await enforceRedactionGate(rast.bytes, targets, {
      rasterizedPages: rast.rasterizedPages,
    });
  } catch (e) {
    // The gate refused to release bytes — no leaky file would ever reach
    // the user. This is a correct safety outcome for the e2e.
    const err = e as { name?: string; message?: string; result?: { vectors?: Record<string, number> } };
    if (err?.name === "RedactionGateError") {
      const blockedVectors: Record<string, number> = {};
      if (err.result?.vectors) {
        for (const [k, v] of Object.entries(err.result.vectors)) {
          if (typeof v === "number" && v > 0) blockedVectors[k] = v;
        }
      }
      return {
        secret: SECRET,
        name: NAME,
        outcome: "blocked",
        blockedMessage: err.message,
        blockedVectors,
      };
    }
    throw e;
  }

  // Step 3 — independent post-hoc text extraction against the FINAL bytes.
  // If the gate returned bytes but our fresh pdf.js pass STILL finds the
  // secret, that's a real "text still traceable" regression.
  const perPageText = await extractTextPerPage(gate.bytes);
  const joined = perPageText.join("\n");
  const secretInRawBytes = containsAnywhere(gate.bytes, SECRET);
  const secretInExtractedText = joined.includes(SECRET) || joined.includes(NAME);
  const outcome: E2eProbe["outcome"] =
    secretInRawBytes || secretInExtractedText ? "leaked" : "clean";

  return {
    secret: SECRET,
    name: NAME,
    outcome,
    secretInRawBytes,
    secretInExtractedText,
    perPageText,
    vectors: gate.verify.vectors,
    outputBytes: gate.bytes.byteLength,
    rasterizedPages: gate.rasterizedPages,
  };
}

// ---------------------------------------------------------------------------
// Fragmented-token fixture — guards the "middle-fragment only" leak class.
//
// pdf.js splits a visibly-single token like "(763) 300-1828" into multiple
// text items whenever the underlying content stream draws it as separate
// Tj/TJ ops (which is what a series of drawText calls produces). A regex
// match hits only ONE of those items; without token expansion the burn
// covers the middle and leaves leading/trailing digits visible AND
// text-extractable. This fixture reproduces that exact split, runs the
// production burn + gate, then re-extracts text to prove the WHOLE
// value — not just the matched fragment — is gone.

const FRAG_PHONE_PARTS = ["0", "781151140428"] as const;
const FRAG_PHONE_FULL = FRAG_PHONE_PARTS.join("");

export interface FragProbe {
  fullValue: string;
  /** Parts that must NOT survive individually — leading & trailing fragments
   *  are the ones the old pipeline leaked. */
  leadingFragment: string;
  trailingFragment: string;
  outcome: "clean" | "blocked" | "leaked";
  /** True when redaction rects covered ALL fragment items (expansion worked). */
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
}

async function buildFragmentedFixture(): Promise<{ bytes: Uint8Array; rectApproxY: number }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Contact info:", { x: 72, y: 720, size: 12, font: helv });
  // Draw the first digit as its own font run and start the remainder with a
  // small reported-bounds overlap. This reproduces the real leading-edge leak:
  // the old token walk treated `gap < -1` as a boundary, so the first digit's
  // item was excluded even though it is part of the same visible value.
  const size = 12;
  const y = 700;
  let x = 72;
  page.drawText(FRAG_PHONE_PARTS[0], { x, y, size, font: bold });
  x += bold.widthOfTextAtSize(FRAG_PHONE_PARTS[0], size) - 1.4;
  page.drawText(FRAG_PHONE_PARTS[1], { x, y, size, font: helv });
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, rectApproxY: y };
}

async function inspectFragmentItems(bytes: Uint8Array): Promise<Array<{ str: string; x0: number; x1: number; y: number; h: number }>> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), enableXfa: true, useSystemFonts: true }).promise;
  const p = await doc.getPage(1);
  const viewport = p.getViewport({ scale: 1.5 });
  const tc = await p.getTextContent();
  return (tc.items as Array<{ str: string; transform: number[]; width: number }>).flatMap((it) => {
    if (!it.str || !it.str.trim()) return [];
    const m = pdfjs.Util.transform(viewport.transform, it.transform);
    const h = Math.hypot(m[2], m[3]);
    return [{ str: it.str, x0: m[4] / 1.5, x1: (m[4] + it.width * 1.5) / 1.5, y: (m[5] - h) / 1.5, h: h / 1.5 }];
  });
}

/**
 * Run the full detection → rasterize → gate pipeline on a fixture whose
 * only sensitive value is a fragmented phone number. Asserts that (a)
 * detection produced rects covering ALL three fragment items (proving the
 * token-expansion pass fired), and (b) an independent re-extraction of
 * the final bytes finds NO fragment of the phone number.
 */
export async function runFragmentedRedactionE2E(): Promise<FragProbe> {
  const { bytes } = await buildFragmentedFixture();
  const beforeText = (await extractTextPerPage(bytes)).join(" ");
  const items = await inspectFragmentItems(bytes);

  // Run the real production detector. skipNer keeps the run fast (no model
  // download needed in headless Chromium); the phone regex handles this
  // fixture on its own.
  const { detectPiiInPdf } = await import("@/lib/pdf/detect-pii");
  const file = new File([bytes as BlobPart], "frag.pdf", { type: "application/pdf" });
  const { detections } = await detectPiiInPdf(file, 1.5, undefined, undefined, {
    skipNer: true,
  });

  // Convert every phone detection into a page-0 RedactionRectTL. We accept
  // any category the detector chose (phone, creditCard fallback for long
  // digit runs, etc.) as long as the rects cover the fragments.
  const pageRects: RedactionRectTL[] = detections
    .filter((d) => d.page === 1 && d.pdfRect)
    .map((d) => {
      const r = d.pdfRect!;
      return { x: r.x, y: r.y, w: r.w, h: r.h };
    });

  const leadingItem = items.find((it) => it.str === FRAG_PHONE_PARTS[0]) ?? null;
  const valueItems = items.filter((it) => FRAG_PHONE_FULL.includes(it.str) || it.str.includes(FRAG_PHONE_FULL));
  const rects = pageRects.map((r) => ({ x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }));
  const leftmostRectX0 = rects.length ? Math.min(...rects.map((r) => r.x0)) : null;
  const rightmostRectX1 = rects.length ? Math.max(...rects.map((r) => r.x1)) : null;
  const valueLeft = valueItems.length ? Math.min(...valueItems.map((it) => it.x0)) : leadingItem?.x0 ?? 0;
  const valueRight = valueItems.length ? Math.max(...valueItems.map((it) => it.x1)) : leadingItem?.x1 ?? 0;
  const leadingCovered = !!leadingItem && rects.some((r) => r.x0 <= leadingItem.x0 && r.x1 >= leadingItem.x1);
  const rectsCoveredAllFragments =
    leftmostRectX0 !== null && rightmostRectX1 !== null && leftmostRectX0 <= valueLeft && rightmostRectX1 >= valueRight;
  const geometry = { items, rects, leadingItem, leftmostRectX0, rightmostRectX1, leadingCovered };

  const pageMap = new Map<number, RedactionRectTL[]>([[0, pageRects]]);
  const rast = await rasterizeRedactedPagesInWorker(bytes, pageMap, {
    scale: 2.5,
    mode: "always",
  });

  const targets = [{ page: 0, text: FRAG_PHONE_FULL, label: "phone" }];
  let gateBytes: Uint8Array;
  try {
    const gate = await enforceRedactionGate(rast.bytes, targets, {
      rasterizedPages: rast.rasterizedPages,
    });
    gateBytes = gate.bytes;
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === "RedactionGateError") {
      return {
        fullValue: FRAG_PHONE_FULL,
        leadingFragment: FRAG_PHONE_PARTS[0],
        trailingFragment: FRAG_PHONE_PARTS[FRAG_PHONE_PARTS.length - 1],
        outcome: "blocked",
        rectsCoveredAllFragments,
        detectionRectCount: pageRects.length,
        beforeText,
        geometry,
        blockedMessage: err.message,
      };
    }
    throw e;
  }

  const perPage = await extractTextPerPage(gateBytes);
  const joined = perPage.join(" ");
  const leadingSurvived = joined.includes(FRAG_PHONE_PARTS[0]);
  const trailingSurvived = joined.includes(FRAG_PHONE_PARTS[FRAG_PHONE_PARTS.length - 1]);
  const fullSurvived = joined.includes(FRAG_PHONE_FULL);
  const outcome: FragProbe["outcome"] =
    leadingSurvived || trailingSurvived || fullSurvived ? "leaked" : "clean";

  return {
    fullValue: FRAG_PHONE_FULL,
    leadingFragment: FRAG_PHONE_PARTS[0],
    trailingFragment: FRAG_PHONE_PARTS[FRAG_PHONE_PARTS.length - 1],
    outcome,
    rectsCoveredAllFragments,
    detectionRectCount: pageRects.length,
    beforeText,
    extractedText: joined,
    geometry,
    leadingSurvived,
    trailingSurvived,
    fullSurvived,
  };
}

// Convenience: expose on window so the Playwright script can just call
// `window.__runMixedRedactionE2E()` without wiring an import graph.
//
// Result delivery is decoupled from the promise's return value on purpose.
// The mixed run is long (rasterize-always → sanitize → verify → re-verify →
// pdf.js re-extract), and on a slow CI runner a page-level navigation/reload
// can tear down the execution context AFTER the probe is computed but BEFORE
// the driving `page.evaluate()` resolves — surfacing as "Execution context
// was destroyed, most likely because of a navigation" even though redaction
// succeeded. To make it deterministic, each wrapper pushes the probe through
// a Playwright-exposed binding (`__reportMixedResult` / `__reportFragResult`)
// the instant it resolves — same microtask as the await continuation, so no
// navigation can interleave before the payload is sent to Node. The binding
// call reaches the driver even if the context dies a moment later. The return
// value is kept as a fallback for any caller that still awaits it directly.
if (typeof window !== "undefined") {
  const w = window as unknown as {
    __runMixedRedactionE2E?: () => Promise<E2eProbe>;
    __runFragmentedRedactionE2E?: () => Promise<FragProbe>;
    __reportMixedResult?: (p: E2eProbe) => void;
    __reportFragResult?: (p: FragProbe) => void;
  };
  w.__runMixedRedactionE2E = async () => {
    const probe = await runMixedRedactionE2E();
    try { w.__reportMixedResult?.(probe); } catch { /* fall back to return value */ }
    return probe;
  };
  w.__runFragmentedRedactionE2E = async () => {
    const probe = await runFragmentedRedactionE2E();
    try { w.__reportFragResult?.(probe); } catch { /* fall back to return value */ }
    return probe;
  };
}

