// Public API: run raw table extraction, then a semantic parser.

import { extractTables, rowsToCsv, type ExtractProgress } from "@/lib/pdf/extract-tables";
import { detectType } from "./detect-type";
import { parseByType } from "./parsers";
import { guessLocale } from "./normalize";
import type { DocType, Locale, ParseResult } from "./types";

export type ExtractTxProgress = ExtractProgress;

export type ExtractTxResult = ParseResult & {
  detected: ReturnType<typeof detectType>;
  locale: Locale;
  /** Raw tables (kept for column-remap re-runs). */
  raw: Awaited<ReturnType<typeof extractTables>>;
  /** Concatenated first-page text used for detection. */
  pageText: string;
};

export async function extractTransactions(
  file: File,
  opts: {
    typeOverride?: DocType | "auto";
    localeOverride?: Locale | "auto";
    onProgress?: (p: ExtractTxProgress) => void;
  } = {},
): Promise<ExtractTxResult> {
  const raw = await extractTables(file, 1.5, opts.onProgress);
  // Rebuild sniff text from first 3 pages worth of rows.
  const sniffPages = raw.slice(0, 3);
  const pageText = sniffPages
    .flatMap((t) => t.rows.map((r) => r.join(" ")))
    .join("\n");
  const detected = detectType(pageText);
  const locale: Locale =
    !opts.localeOverride || opts.localeOverride === "auto"
      ? guessLocale(pageText)
      : opts.localeOverride;
  const type: DocType =
    !opts.typeOverride || opts.typeOverride === "auto"
      ? detected.type
      : opts.typeOverride;

  const parsed = parseByType(type, { tables: raw, pageText, locale });
  return { ...parsed, detected, locale, raw, pageText };
}

/** Re-run parsing with a new mapping (no re-extraction). */
export function reparse(
  result: ExtractTxResult,
  type: DocType,
  locale: Locale,
): ExtractTxResult {
  const parsed = parseByType(type, {
    tables: result.raw,
    pageText: result.pageText,
    locale,
  });
  return { ...result, ...parsed, locale };
}

// ------------------------------------------------------------------ export

export function rowsToTypedCsv(result: ParseResult): string {
  const headers = result.schema.map((s) => s.label);
  const body = result.rows.map((r) =>
    result.schema.map((s) => fmt(r[s.key])),
  );
  return rowsToCsv([headers, ...body]);
}

function fmt(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") return String(v);
  return String(v);
}

export async function downloadTypedXlsx(
  result: ExtractTxResult,
  filename: string,
) {
  const { importChunk } = await import("@/lib/chunk-import");
  const XLSX = await importChunk(() => import("xlsx"));
  const wb = XLSX.utils.book_new();
  const headers = result.schema.map((s) => s.label);
  const body = result.rows.map((r) =>
    result.schema.map((s) => {
      const v = r[s.key];
      return v == null || v === "" ? "" : v;
    }),
  );
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");

  if (result.type === "bank_statement") {
    const summary: (string | number)[][] = [["Metric", "Value"]];
    if (result.header) {
      for (const [k, v] of Object.entries(result.header)) {
        summary.push([k, v == null ? "" : (v as string | number)]);
      }
    }
    const totals = summarizeByMonth(result.rows);
    summary.push([], ["Month", "Debits", "Credits", "Net"]);
    for (const t of totals) summary.push([t.month, t.debits, t.credits, t.net]);
    const byCat = summarizeByCategory(result.rows);
    if (byCat.length) {
      summary.push([], ["Category", "Total"]);
      for (const t of byCat) summary.push([t.category, t.total]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");
  } else if (result.type === "invoice" && result.header) {
    const hdr: (string | number)[][] = [["Field", "Value"]];
    for (const [k, v] of Object.entries(result.header)) {
      hdr.push([k, v == null ? "" : (v as string | number)]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hdr), "Header");
  }
  XLSX.writeFile(wb, filename);
}

function summarizeByMonth(rows: ParseResult["rows"]) {
  const map = new Map<string, { debits: number; credits: number; net: number }>();
  for (const r of rows) {
    const d = r.date as string | undefined;
    if (!d) continue;
    const m = d.slice(0, 7);
    const bucket = map.get(m) ?? { debits: 0, credits: 0, net: 0 };
    const debit = r.debit as number | null;
    const credit = r.credit as number | null;
    const amount = r.amount as number | null;
    if (typeof debit === "number") bucket.debits += debit;
    if (typeof credit === "number") bucket.credits += credit;
    if (typeof amount === "number") bucket.net += amount;
    map.set(m, bucket);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));
}

function summarizeByCategory(rows: ParseResult["rows"]) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const c = (r.category as string) || "uncategorized";
    const a = r.amount as number | null;
    if (typeof a !== "number") continue;
    map.set(c, (map.get(c) ?? 0) + a);
  }
  return [...map.entries()]
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .map(([category, total]) => ({ category, total }));
}

export type { DocType, Locale, ParseResult } from "./types";
