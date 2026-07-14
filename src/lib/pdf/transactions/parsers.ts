// Semantic parsers — turn raw ExtractedTable[] rows into typed transactions.

import type { ExtractedTable } from "@/lib/pdf/extract-tables";
import type {
  DocType, ParseCtx, ParseResult, SchemaColumn, TypedRow,
} from "./types";
import { parseAmount, parseDate, looksNumeric } from "./normalize";
import { UTBMS_TASK_CODES, UTBMS_ACTIVITY_CODES, UTBMS_EXPENSE_CODES } from "./utbms";

// ------------------------------------------------------------------ helpers

/** Flatten tables into one long list of rows tagged by page. */
function flatten(tables: ExtractedTable[]): { page: number; row: string[] }[] {
  const out: { page: number; row: string[] }[] = [];
  for (const t of tables) {
    for (const r of t.rows) {
      if (r.some((c) => c && c.trim())) out.push({ page: t.page, row: r });
    }
  }
  return out;
}

function findHeaderRow(
  rows: string[][],
  keywords: string[][],
): { index: number; map: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map((c) => (c ?? "").toLowerCase());
    const map: Record<string, number> = {};
    for (const group of keywords) {
      const idx = cells.findIndex((c) => group.some((k) => c.includes(k)));
      if (idx >= 0) map[group[0]] = idx;
    }
    if (Object.keys(map).length >= Math.ceil(keywords.length / 2)) {
      return { index: i, map };
    }
  }
  return null;
}

function widestRowLen(rows: string[][]): number {
  let n = 0;
  for (const r of rows) if (r.length > n) n = r.length;
  return n;
}

// ------------------------------------------------------------------ bank

export function parseBankStatement(ctx: ParseCtx): ParseResult {
  const flat = flatten(ctx.tables).map((r) => r.row);
  const warnings: string[] = [];
  const header = findHeaderRow(flat, [
    ["date", "posted", "trans date"],
    ["description", "details", "transaction", "memo"],
    ["debit", "withdrawal", "amount out"],
    ["credit", "deposit", "amount in"],
    ["amount"],
    ["balance"],
  ]);
  const nCols = widestRowLen(flat);
  let mapping: Record<string, number | null> = {
    date: header?.map.date ?? 0,
    description: header?.map.description ?? 1,
    debit: header?.map.debit ?? null,
    credit: header?.map.credit ?? null,
    amount: header?.map.amount ?? (nCols >= 4 ? nCols - 2 : null),
    balance: header?.map.balance ?? (nCols >= 2 ? nCols - 1 : null),
  };
  if (mapping.debit == null && mapping.credit == null && mapping.amount == null) {
    mapping.amount = Math.max(0, nCols - 2);
  }

  const startIdx = header ? header.index + 1 : 0;
  const rows: TypedRow[] = [];
  const refYear = detectYear(ctx.pageText);
  for (let i = startIdx; i < flat.length; i++) {
    const r = flat[i];
    const dateRaw = pick(r, mapping.date);
    const iso = parseDate(dateRaw, ctx.locale, refYear);
    if (!iso) continue; // row without a real date isn't a transaction
    const desc = pick(r, mapping.description).trim();
    const debit = amt(pick(r, mapping.debit), ctx.locale);
    const credit = amt(pick(r, mapping.credit), ctx.locale);
    const amountCol = amt(pick(r, mapping.amount), ctx.locale);
    const balance = amt(pick(r, mapping.balance), ctx.locale);
    let amount: number | null = amountCol;
    if (amount == null && (debit != null || credit != null)) {
      amount = (credit ?? 0) - (Math.abs(debit ?? 0));
    }
    rows.push({
      date: iso,
      description: desc,
      debit: debit != null ? Math.abs(debit) : null,
      credit: credit != null ? Math.abs(credit) : null,
      amount,
      balance,
      category: guessCategory(desc),
    });
  }
  if (rows.length === 0) warnings.push("No dated rows detected — try changing the type or remapping the Date column.");

  const schema: SchemaColumn[] = [
    { key: "date", label: "Date", kind: "date" },
    { key: "description", label: "Description", kind: "text" },
    { key: "debit", label: "Debit", kind: "money" },
    { key: "credit", label: "Credit", kind: "money" },
    { key: "amount", label: "Amount", kind: "money" },
    { key: "balance", label: "Balance", kind: "money" },
    { key: "category", label: "Category", kind: "text" },
  ];
  const hdr = extractBankHeader(ctx.pageText);
  return { type: "bank_statement", schema, rows, header: hdr, mapping, warnings };
}

function detectYear(text: string): number | undefined {
  const m = text.match(/\b(20\d{2}|19\d{2})\b/);
  return m ? +m[1] : undefined;
}

function extractBankHeader(text: string): Record<string, string | number | null> {
  const h: Record<string, string | number | null> = {};
  const beg = text.match(/Beginning\s+balance[^\d\-\(]*([\-\(\)\d.,$€£]+)/i);
  const end = text.match(/Ending\s+balance[^\d\-\(]*([\-\(\)\d.,$€£]+)/i);
  if (beg) h.beginning_balance = parseAmount(beg[1]).value;
  if (end) h.ending_balance = parseAmount(end[1]).value;
  const acc = text.match(/Account\s*(?:#|no\.?|number)\s*[:\-]?\s*([A-Z0-9\-]{4,})/i);
  if (acc) h.account_number = acc[1];
  return h;
}

function guessCategory(desc: string): string {
  const d = desc.toLowerCase();
  if (/\b(payroll|salary|wages|direct dep)/.test(d)) return "payroll";
  if (/\b(transfer|xfer|to acct|from acct)/.test(d)) return "transfer";
  if (/\b(fee|charge|service chg)/.test(d)) return "fee";
  if (/\batm\b/.test(d)) return "atm";
  if (/\b(pos|debit card|visa|mastercard|amex|purchase)/.test(d)) return "card";
  if (/\bcheck\s*#?\d/.test(d)) return "check";
  if (/\b(deposit|credit)/.test(d)) return "deposit";
  if (/\b(interest)/.test(d)) return "interest";
  return "";
}

// ------------------------------------------------------------------ invoice

export function parseInvoice(ctx: ParseCtx): ParseResult {
  const flat = flatten(ctx.tables).map((r) => r.row);
  const warnings: string[] = [];
  const header = findHeaderRow(flat, [
    ["description", "item", "service"],
    ["qty", "quantity", "hours"],
    ["unit", "rate", "price"],
    ["amount", "total", "line total"],
    ["tax", "vat"],
  ]);
  const nCols = widestRowLen(flat);
  const mapping: Record<string, number | null> = {
    line_no: null,
    description: header?.map.description ?? 0,
    qty: header?.map.qty ?? null,
    unit_price: header?.map.unit ?? null,
    amount: header?.map.amount ?? Math.max(0, nCols - 1),
    tax: header?.map.tax ?? null,
  };

  const startIdx = header ? header.index + 1 : 0;
  const rows: TypedRow[] = [];
  let n = 0;
  for (let i = startIdx; i < flat.length; i++) {
    const r = flat[i];
    const desc = pick(r, mapping.description).trim();
    const amount = amt(pick(r, mapping.amount), ctx.locale);
    // Must have description + at least one numeric field to be a line item.
    if (!desc || amount == null) continue;
    n += 1;
    rows.push({
      line_no: n,
      description: desc,
      qty: amt(pick(r, mapping.qty), ctx.locale),
      unit_price: amt(pick(r, mapping.unit_price), ctx.locale),
      amount,
      tax: amt(pick(r, mapping.tax), ctx.locale),
    });
  }

  const hdr = extractInvoiceHeader(ctx.pageText, ctx.locale);
  if (hdr.subtotal != null) {
    const sum = rows.reduce((s, r) => s + (typeof r.amount === "number" ? r.amount : 0), 0);
    if (Math.abs(sum - (hdr.subtotal as number)) > 0.05) {
      warnings.push(`Line-item total (${sum.toFixed(2)}) doesn't match subtotal (${(hdr.subtotal as number).toFixed(2)}).`);
    }
  }
  if (rows.length === 0) warnings.push("No line items detected — remap the Description/Amount columns or switch to Generic.");

  const schema: SchemaColumn[] = [
    { key: "line_no", label: "#", kind: "number" },
    { key: "description", label: "Description", kind: "text" },
    { key: "qty", label: "Qty", kind: "number" },
    { key: "unit_price", label: "Unit price", kind: "money" },
    { key: "amount", label: "Amount", kind: "money" },
    { key: "tax", label: "Tax", kind: "money" },
  ];
  return { type: "invoice", schema, rows, header: hdr, mapping, warnings };
}

function extractInvoiceHeader(text: string, locale: "US" | "EU"): Record<string, string | number | null> {
  const h: Record<string, string | number | null> = {};
  const m = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;
  h.invoice_no = m(/Invoice\s*(?:#|no\.?|number)\s*[:\-]?\s*([A-Za-z0-9\-\/]+)/i);
  const dateStr = m(/Invoice\s+date\s*[:\-]?\s*(.+)/i) ?? m(/Date\s*[:\-]?\s*([A-Za-z0-9,\/\-\s]+)/i);
  if (dateStr) h.invoice_date = parseDate(dateStr, locale);
  const dueStr = m(/Due\s+date\s*[:\-]?\s*(.+)/i);
  if (dueStr) h.due_date = parseDate(dueStr, locale);
  const sub = m(/Subtotal\s*[:\-]?\s*([\-\(\)\d.,$€£]+)/i);
  if (sub) h.subtotal = parseAmount(sub, locale).value;
  const tax = m(/(?:Tax|VAT)\s*[:\-]?\s*([\-\(\)\d.,$€£]+)/i);
  if (tax) h.tax = parseAmount(tax, locale).value;
  const tot = m(/(?:Total\s+due|Amount\s+due|Total)\s*[:\-]?\s*([\-\(\)\d.,$€£]+)/i);
  if (tot) h.total = parseAmount(tot, locale).value;
  h.vendor = m(/(?:From|Vendor|Bill\s+from)\s*[:\-]?\s*(.+)/i);
  return h;
}

// ------------------------------------------------------------------ ledes

export function parseLedes(ctx: ParseCtx): ParseResult {
  const warnings: string[] = [];
  // Detect pipe-delimited 1998B block first.
  if (/INVOICE_DATE\|INVOICE_NUMBER/i.test(ctx.pageText)) {
    return parseLedesPipe(ctx, warnings);
  }
  const flat = flatten(ctx.tables).map((r) => r.row);
  const header = findHeaderRow(flat, [
    ["date"],
    ["timekeeper", "atty", "attorney", "initials"],
    ["task"],
    ["activity", "act"],
    ["hours", "hrs"],
    ["rate"],
    ["amount", "value"],
    ["description", "narrative", "notes"],
  ]);
  const nCols = widestRowLen(flat);
  const mapping: Record<string, number | null> = {
    date: header?.map.date ?? 0,
    timekeeper_id: header?.map.timekeeper ?? null,
    timekeeper_name: null,
    task_code: header?.map.task ?? null,
    activity_code: header?.map.activity ?? null,
    expense_code: null,
    hours: header?.map.hours ?? null,
    rate: header?.map.rate ?? null,
    amount: header?.map.amount ?? Math.max(0, nCols - 1),
    narrative: header?.map.description ?? Math.min(nCols - 1, Math.max(0, nCols - 2)),
  };

  const startIdx = header ? header.index + 1 : 0;
  const rows: TypedRow[] = [];
  const refYear = detectYear(ctx.pageText);
  let taskHits = 0, taskChecks = 0;
  for (let i = startIdx; i < flat.length; i++) {
    const r = flat[i];
    const iso = parseDate(pick(r, mapping.date), ctx.locale, refYear);
    if (!iso) continue;
    const task = pick(r, mapping.task_code).toUpperCase().replace(/\s+/g, "");
    if (task) { taskChecks++; if (UTBMS_TASK_CODES.has(task)) taskHits++; }
    rows.push({
      date: iso,
      timekeeper_id: pick(r, mapping.timekeeper_id).trim(),
      timekeeper_name: pick(r, mapping.timekeeper_name).trim(),
      task_code: task,
      activity_code: pick(r, mapping.activity_code).toUpperCase().trim(),
      expense_code: pick(r, mapping.expense_code).toUpperCase().trim(),
      hours: amt(pick(r, mapping.hours), ctx.locale),
      rate: amt(pick(r, mapping.rate), ctx.locale),
      amount: amt(pick(r, mapping.amount), ctx.locale),
      narrative: pick(r, mapping.narrative).trim(),
    });
  }
  if (taskChecks > 3 && taskHits / taskChecks < 0.3) {
    warnings.push("Task-code column mostly unrecognised — you may need to remap it.");
  }
  if (rows.length === 0) warnings.push("No dated fee entries detected.");

  const schema = ledesSchema();
  return { type: "ledes", schema, rows, mapping, warnings };
}

function parseLedesPipe(ctx: ParseCtx, warnings: string[]): ParseResult {
  const lines = ctx.pageText.split(/\r?\n/).filter((l) => l.includes("|"));
  if (lines.length < 2) {
    warnings.push("LEDES 1998B block detected but couldn't parse rows.");
    return { type: "ledes", schema: ledesSchema(), rows: [], mapping: {}, warnings };
  }
  const head = lines[0].split("|").map((s) => s.trim().toUpperCase());
  const idx = (k: string) => head.indexOf(k);
  const mapping: Record<string, number | null> = {
    date: idx("LINE_ITEM_DATE"),
    timekeeper_id: idx("TIMEKEEPER_ID"),
    timekeeper_name: idx("TIMEKEEPER_NAME"),
    task_code: idx("LINE_ITEM_TASK_CODE"),
    activity_code: idx("LINE_ITEM_ACTIVITY_CODE"),
    expense_code: idx("LINE_ITEM_EXPENSE_CODE"),
    hours: idx("LINE_ITEM_NUMBER_OF_UNITS"),
    rate: idx("LINE_ITEM_UNIT_COST"),
    amount: idx("LINE_ITEM_TOTAL"),
    narrative: idx("LINE_ITEM_DESCRIPTION"),
  };
  const rows: TypedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i].split("|").map((s) => s.trim());
    const iso = parseDate(pick(r, mapping.date), ctx.locale);
    if (!iso) continue;
    rows.push({
      date: iso,
      timekeeper_id: pick(r, mapping.timekeeper_id),
      timekeeper_name: pick(r, mapping.timekeeper_name),
      task_code: pick(r, mapping.task_code).toUpperCase(),
      activity_code: pick(r, mapping.activity_code).toUpperCase(),
      expense_code: pick(r, mapping.expense_code).toUpperCase(),
      hours: amt(pick(r, mapping.hours), ctx.locale),
      rate: amt(pick(r, mapping.rate), ctx.locale),
      amount: amt(pick(r, mapping.amount), ctx.locale),
      narrative: pick(r, mapping.narrative),
    });
  }
  return { type: "ledes", schema: ledesSchema(), rows, mapping, warnings };
}

function ledesSchema(): SchemaColumn[] {
  return [
    { key: "date", label: "Date", kind: "date" },
    { key: "timekeeper_id", label: "TK ID", kind: "text" },
    { key: "timekeeper_name", label: "Timekeeper", kind: "text" },
    { key: "task_code", label: "Task", kind: "text" },
    { key: "activity_code", label: "Activity", kind: "text" },
    { key: "expense_code", label: "Expense", kind: "text" },
    { key: "hours", label: "Hours", kind: "number" },
    { key: "rate", label: "Rate", kind: "money" },
    { key: "amount", label: "Amount", kind: "money" },
    { key: "narrative", label: "Narrative", kind: "text" },
  ];
}

// ------------------------------------------------------------------ generic

export function parseGeneric(ctx: ParseCtx): ParseResult {
  const flat = flatten(ctx.tables).map((r) => r.row);
  if (flat.length === 0) {
    return { type: "generic", schema: [], rows: [], mapping: {}, warnings: ["No tables found."] };
  }
  const nCols = widestRowLen(flat);
  // First row as headers if all cells non-numeric
  const first = flat[0].map((c) => (c ?? "").trim());
  const useHeader = first.every((c) => c && !looksNumeric(c));
  const headers = useHeader ? first : Array.from({ length: nCols }, (_, i) => `col_${i + 1}`);
  const schema: SchemaColumn[] = headers.map((h, i) => ({
    key: `c${i}`, label: h || `col_${i + 1}`, kind: "text",
  }));
  const startIdx = useHeader ? 1 : 0;
  const mapping: Record<string, number | null> = {};
  schema.forEach((s, i) => { mapping[s.key] = i; });
  const rows: TypedRow[] = [];
  for (let i = startIdx; i < flat.length; i++) {
    const row: TypedRow = {};
    schema.forEach((s, j) => {
      const v = pick(flat[i], j);
      const n = amt(v, ctx.locale);
      row[s.key] = n != null && looksNumeric(v) ? n : v;
    });
    rows.push(row);
  }
  return { type: "generic", schema, rows, mapping, warnings: [] };
}

// ------------------------------------------------------------------ dispatch

export function parseByType(type: DocType, ctx: ParseCtx): ParseResult {
  switch (type) {
    case "bank_statement": return parseBankStatement(ctx);
    case "invoice": return parseInvoice(ctx);
    case "ledes": return parseLedes(ctx);
    case "generic": return parseGeneric(ctx);
  }
}

// ------------------------------------------------------------------ small utils

function pick(row: string[], idx: number | null): string {
  if (idx == null || idx < 0 || idx >= row.length) return "";
  return row[idx] ?? "";
}
function amt(raw: string, locale: "US" | "EU"): number | null {
  if (!raw) return null;
  return parseAmount(raw, locale).value;
}

// re-export for callers
export { UTBMS_ACTIVITY_CODES, UTBMS_EXPENSE_CODES };
