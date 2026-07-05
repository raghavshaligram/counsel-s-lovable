/**
 * Main-thread op registry — ops that CANNOT run inside the automation Web
 * Worker because they need the DOM (canvas, pdf.js text layer, Tesseract).
 *
 * These execute on the main thread from the runner, in the same pipeline
 * as worker ops. They reuse the app's verified engines verbatim (OCR path,
 * pattern-search + rasterizer + redaction gate) — no new redaction logic.
 */

import type { RegisteredOp, ProgressEvent } from "./types";
import { importChunk } from "@/lib/chunk-import";

/* ------------------------------------------------------------------ */
/* OCR                                                                */
/* ------------------------------------------------------------------ */

export interface OcrParams {
  languages?: string[];
  highAccuracy?: boolean;
}

function bytesToFile(bytes: Uint8Array, name = "in.pdf"): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

function makeOcr(
  emit?: (ev: Extract<ProgressEvent, { type: "step-progress" }>) => void,
  index = 0,
  total = 1,
): RegisteredOp<OcrParams> {
  return async (bytes, params) => {
    const { ocrPdfToSearchable } = await importChunk(
      () => import("@/lib/pdf/ocr-pdf"),
    );
    const out = await ocrPdfToSearchable(
      bytesToFile(bytes, "ocr.pdf"),
      (p) => {
        const pct = p.totalPages > 0 ? Math.min(1, p.page / p.totalPages) : 0;
        emit?.({
          type: "step-progress",
          index,
          total,
          op: "ocr",
          pct,
          message: `${p.stage} page ${p.page}/${p.totalPages}`,
        });
      },
      undefined,
      {
        highAccuracy: !!params?.highAccuracy,
        languages: params?.languages && params.languages.length
          ? params.languages
          : ["eng"],
      },
    );
    return out;
  };
}

/* ------------------------------------------------------------------ */
/* Pattern / bulk redact                                              */
/* ------------------------------------------------------------------ */

export interface RedactPatternParams {
  query: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  ocr?: boolean;
  scope?: "word" | "line" | "sentence" | "page";
}

function makeRedactPattern(
  emit?: (ev: Extract<ProgressEvent, { type: "step-progress" }>) => void,
  index = 0,
  total = 1,
): RegisteredOp<RedactPatternParams> {
  return async (bytes, params) => {
    const query = (params?.query ?? "").trim();
    if (!query) {
      throw new Error("Pattern redact: query is empty.");
    }

    emit?.({
      type: "step-progress",
      index,
      total,
      op: "redact-pattern",
      pct: 0,
      message: "Searching…",
    });

    const { findKeywordInPdf } = await importChunk(
      () => import("@/lib/pdf/detect-pii"),
    );
    const matches = await findKeywordInPdf(
      bytesToFile(bytes, "redact.pdf"),
      query,
      {
        matchCase: !!params?.matchCase,
        wholeWord: !!params?.wholeWord,
        regex: !!params?.regex,
        ocr: !!params?.ocr,
        scope: params?.scope ?? "word",
        onProgress: (p) => {
          const pct = p.totalPages > 0 ? (0.5 * p.page) / p.totalPages : 0;
          emit?.({
            type: "step-progress",
            index,
            total,
            op: "redact-pattern",
            pct,
            message: `${p.stage} page ${p.page}/${p.totalPages}`,
          });
        },
      },
    );

    if (matches.length === 0) {
      emit?.({
        type: "step-progress",
        index,
        total,
        op: "redact-pattern",
        pct: 1,
        message: "No matches — nothing to redact.",
      });
      return bytes;
    }

    // Group PDF-point rects by 0-indexed page.
    const rectsByPage = new Map<
      number,
      { x: number; y: number; w: number; h: number }[]
    >();
    for (const m of matches) {
      const r = m.pdfRect;
      if (!r || r.w <= 0 || r.h <= 0) continue;
      const idx = m.page - 1;
      const arr = rectsByPage.get(idx) ?? [];
      arr.push({ x: r.x, y: r.y, w: r.w, h: r.h });
      rectsByPage.set(idx, arr);
    }

    if (rectsByPage.size === 0) {
      // Page-scope matches don't emit pdfRect; nothing to burn geometrically.
      return bytes;
    }

    emit?.({
      type: "step-progress",
      index,
      total,
      op: "redact-pattern",
      pct: 0.6,
      message: `Burning ${matches.length} redaction${matches.length === 1 ? "" : "s"}…`,
    });

    // Pre-burn ALL matched regions via the verified rasterizer. The gate
    // will re-verify and re-raster any pages that still leak.
    const { rasterizeRedactedPages } = await importChunk(
      () => import("@/lib/editor/rasterize-redacted-pages"),
    );
    const preBurn = await rasterizeRedactedPages(bytes, rectsByPage, {
      mode: "always",
      scale: 2.5,
    });

    emit?.({
      type: "step-progress",
      index,
      total,
      op: "redact-pattern",
      pct: 0.85,
      message: "Verifying redaction…",
    });

    // Feed into the unbypassable gate so we get sanitize + multi-vector
    // verification + rasterize-fallback exactly like the manual redact path.
    const targets = matches
      .filter((m) => m.pdfRect)
      .map((m) => ({
        page: m.page - 1,
        text: m.source?.redactText ?? m.snippet ?? query,
        rect: m.pdfRect!,
      }));

    const { enforceRedactionGate } = await importChunk(
      () => import("@/lib/editor/redaction-gate"),
    );
    const res = await enforceRedactionGate(preBurn.bytes, targets, {
      rasterizedPages: preBurn.rasterizedPages,
      onProgress: (step) => {
        emit?.({
          type: "step-progress",
          index,
          total,
          op: "redact-pattern",
          pct: 0.9,
          message: `gate: ${step}`,
        });
      },
    });
    return res.bytes;
  };
}

/* ------------------------------------------------------------------ */
/* Repair (qpdf WASM + pdf.js — main thread)                          */
/* ------------------------------------------------------------------ */

function makeRepair(
  emit?: (ev: Extract<ProgressEvent, { type: "step-progress" }>) => void,
  index = 0,
  total = 1,
): RegisteredOp<void> {
  return async (bytes) => {
    emit?.({
      type: "step-progress",
      index,
      total,
      op: "repair",
      pct: 0,
      message: "Repairing…",
    });
    const { repairPdfBytes } = await importChunk(() => import("@/lib/pdf/repair"));
    const res = await repairPdfBytes(bytes);
    emit?.({
      type: "step-progress",
      index,
      total,
      op: "repair",
      pct: 1,
      message: `${res.outcome} (${res.pagesRecovered}/${res.pagesExpected} pages, via ${res.method})`,
    });
    return res.bytes;
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

export const MAIN_OP_NAMES = new Set<string>(["ocr", "redact-pattern", "repair"]);

export function isMainThreadOp(name: string): boolean {
  return MAIN_OP_NAMES.has(name);
}

/** Build a main-thread op bound to a progress emitter for this step. */
export function getMainOp(
  name: string,
  emit: (ev: Extract<ProgressEvent, { type: "step-progress" }>) => void,
  index: number,
  total: number,
): RegisteredOp<unknown> | null {
  if (name === "ocr") return makeOcr(emit, index, total) as RegisteredOp<unknown>;
  if (name === "redact-pattern")
    return makeRedactPattern(emit, index, total) as RegisteredOp<unknown>;
  if (name === "repair") return makeRepair(emit, index, total) as RegisteredOp<unknown>;
  return null;
}

