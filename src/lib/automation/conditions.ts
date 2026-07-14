/**
 * Conditional workflow steps.
 *
 * Each step MAY carry a `condition` — a predicate evaluated against the
 * current bytes before the step runs. When the predicate is false, the
 * runner emits a `step-skipped` event and passes bytes through unchanged.
 *
 * All predicates are pure & on-device. Text-based checks lazily extract
 * the PDF text layer via pdf.js (first ~10 pages, cached per input) so
 * we don't pay the cost more than once for a chain like
 * `if scanned → OCR` followed by `if sensitive → redact`.
 *
 * Kept intentionally simple — this is a UX-facing gate, not a full
 * expression engine.
 */

import { getPdfjs } from "@/lib/pdf/worker";
import { PATTERNS } from "@/lib/pdf/detect-pii";
import { PRIVILEGE_TERMS_RE } from "@/lib/pdf/ner";

export type ConditionKind =
  | "always"
  | "if-scanned"
  | "if-has-text"
  | "if-has-sensitive"
  | "if-has-privilege"
  | "if-size-over-mb";

export interface StepCondition {
  kind: ConditionKind;
  /** Threshold in MB for `if-size-over-mb`. */
  thresholdMb?: number;
}

export const CONDITION_LABELS: Record<ConditionKind, string> = {
  "always": "Always run",
  "if-scanned": "If document is scanned (no text layer)",
  "if-has-text": "If document has a text layer",
  "if-has-sensitive": "If sensitive data (PII) was found",
  "if-has-privilege": "If privilege markers found",
  "if-size-over-mb": "If file size exceeds threshold (MB)",
};

export const CONDITION_SHORT: Record<ConditionKind, string> = {
  "always": "always",
  "if-scanned": "if scanned",
  "if-has-text": "if digital",
  "if-has-sensitive": "if PII",
  "if-has-privilege": "if privileged",
  "if-size-over-mb": "if large",
};

/* ---------------- Per-run cache ---------------- */

interface TextScan {
  totalTextChars: number;
  pagesScanned: number;
  sampleText: string;
}

export interface ConditionContext {
  bytes: Uint8Array;
  /** Lazy — filled on first request. */
  _textScan?: Promise<TextScan | null>;
}

export function makeConditionContext(bytes: Uint8Array): ConditionContext {
  return { bytes };
}

async function getTextScan(ctx: ConditionContext): Promise<TextScan | null> {
  if (!ctx._textScan) {
    ctx._textScan = (async () => {
      try {
        const pdfjs = await getPdfjs();
        const loadingTask = pdfjs.getDocument({
          data: ctx.bytes.slice(),
          disableAutoFetch: true,
          disableStream: true, enableXfa: true, useSystemFonts: true });
        const doc = await loadingTask.promise;
        const maxPages = Math.min(doc.numPages, 10);
        let total = 0;
        const chunks: string[] = [];
        for (let p = 1; p <= maxPages; p++) {
          const page = await doc.getPage(p);
          const tc = await page.getTextContent();
          const items = tc.items as Array<{ str?: string }>;
          const pageText = items.map((it) => it.str ?? "").join(" ");
          total += pageText.replace(/\s+/g, "").length;
          chunks.push(pageText);
          page.cleanup();
        }
        try { await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* noop */ }
        return {
          totalTextChars: total,
          pagesScanned: maxPages,
          sampleText: chunks.join("\n"),
        };
      } catch {
        return null;
      }
    })();
  }
  return ctx._textScan;
}

/** Heuristic: <20 chars of text per scanned page ⇒ image-only / scanned. */
function isScanned(scan: TextScan | null): boolean {
  if (!scan || scan.pagesScanned === 0) return false;
  const perPage = scan.totalTextChars / scan.pagesScanned;
  return perPage < 20;
}

function hasSensitive(scan: TextScan | null): boolean {
  if (!scan) return false;
  const text = scan.sampleText;
  for (const { re } of PATTERNS) {
    // Ensure a fresh (non-sticky, non-global) exec to avoid state leak.
    const fresh = new RegExp(re.source, re.flags.replace(/g/g, ""));
    if (fresh.test(text)) return true;
  }
  return false;
}

function hasPrivilege(scan: TextScan | null): boolean {
  if (!scan) return false;
  const fresh = new RegExp(PRIVILEGE_TERMS_RE.source, PRIVILEGE_TERMS_RE.flags.replace(/g/g, ""));
  return fresh.test(scan.sampleText);
}

export interface ConditionResult {
  passed: boolean;
  reason: string;
}

export async function evaluateCondition(
  cond: StepCondition | undefined,
  ctx: ConditionContext,
): Promise<ConditionResult> {
  const kind = cond?.kind ?? "always";
  switch (kind) {
    case "always":
      return { passed: true, reason: "always" };

    case "if-size-over-mb": {
      const mb = ctx.bytes.byteLength / (1024 * 1024);
      const th = Number(cond?.thresholdMb ?? 5);
      return {
        passed: mb > th,
        reason: `${mb.toFixed(1)} MB ${mb > th ? ">" : "≤"} ${th} MB`,
      };
    }

    case "if-scanned": {
      const scan = await getTextScan(ctx);
      const scanned = isScanned(scan);
      return {
        passed: scanned,
        reason: scanned ? "no text layer detected" : "text layer present",
      };
    }
    case "if-has-text": {
      const scan = await getTextScan(ctx);
      const scanned = isScanned(scan);
      return {
        passed: !scanned,
        reason: scanned ? "no text layer" : "text layer present",
      };
    }
    case "if-has-sensitive": {
      const scan = await getTextScan(ctx);
      const found = hasSensitive(scan);
      return {
        passed: found,
        reason: found ? "PII pattern matched" : "no PII pattern matched",
      };
    }
    case "if-has-privilege": {
      const scan = await getTextScan(ctx);
      const found = hasPrivilege(scan);
      return {
        passed: found,
        reason: found ? "privilege term matched" : "no privilege terms",
      };
    }
  }
}
