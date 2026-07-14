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
    ["date", "posted", "trans date", "txn date"],
    ["description", "details", "transaction", "memo", "particulars", "narration"],
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

  const bankStartHeader = findBankTransactionHeaderIndex(flat);
  const startIdx = bankStartHeader >= 0 ? bankStartHeader + 1 : header ? header.index + 1 : 0;
  const rows: TypedRow[] = [];
  const refYear = detectYear(ctx.pageText);
  const dateLocale = detectNumericDateLocale(ctx.pageText, ctx.locale);
  let currentMapping = { ...mapping };
  let previousBalance: number | null = null;
  let pendingDescription: string[] = [];
  let lastTransactionIndex: number | null = null;

  for (let i = startIdx; i < flat.length; i++) {
    const r = flat[i];
    const rowText = cleanDescription(r.join(" "));
    if (isBankTerminalNoise(rowText)) {
      if (rows.length > 0) break;
      continue;
    }
    const headerMap = bankHeaderMap(r);
    if (headerMap) {
      currentMapping = { ...currentMapping, ...headerMap };
      pendingDescription = [];
      continue;
    }

    const dateInfo = findDateInRow(r, currentMapping.date, dateLocale, refYear);
    if (!dateInfo.iso) {
      const line = bankContinuationText(r, currentMapping);
      if (!line || isBankNoise(line)) continue;
      if (pendingDescription.length > 0 || looksBankTransactionStart(line)) {
        pendingDescription.push(line);
      } else if (lastTransactionIndex != null) {
        rows[lastTransactionIndex].description = cleanDescription(
          `${rows[lastTransactionIndex].description ?? ""} ${line}`,
        );
      } else {
        pendingDescription.push(line);
      }
      continue;
    }

    const moneyCells = monetaryCells(r, ctx.locale);
    const balanceCell = chooseBalanceCell(moneyCells, currentMapping.balance);
    const amountCell = chooseTransactionAmountCell(moneyCells, balanceCell?.idx ?? null, currentMapping);

    if (!amountCell) {
      if (balanceCell) previousBalance = balanceCell.value;
      pendingDescription = [];
      continue;
    }

    const balance = balanceCell?.value ?? null;
    const signedAmount = signedBankAmount(amountCell, balance, previousBalance, currentMapping);
    const debit = signedAmount < 0 ? Math.abs(signedAmount) : null;
    const credit = signedAmount > 0 ? Math.abs(signedAmount) : null;
    const desc = cleanDescription(
      [
        ...pendingDescription,
        bankDateCellRemainder(dateInfo.raw),
        bankRowDescription(r, currentMapping, amountCell.idx, balanceCell?.idx ?? null),
      ].filter(Boolean).join(" "),
    );
    if (isBankNoise(desc) || isBankTerminalNoise(desc)) {
      if (balance != null) previousBalance = balance;
      pendingDescription = [];
      continue;
    }

    rows.push({
      date: dateInfo.iso,
      description: desc,
      debit,
      credit,
      amount: signedAmount,
      balance,
      category: guessCategory(desc),
    });

    if (balance != null) previousBalance = balance;
    pendingDescription = [];
    lastTransactionIndex = rows.length - 1;
  }

  if (rows.length === 0) {
    warnings.push("No dated rows detected — try changing the type or remapping the Date column.");
  } else {
    const missingAmounts = rows.filter((r) => typeof r.amount !== "number").length;
    if (missingAmounts > Math.max(5, rows.length * 0.1)) {
      warnings.push("Some dated rows were found without a transaction amount — check the preview before exporting.");
    }
  }

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

function bankHeaderMap(row: string[]): Record<string, number | null> | null {
  const cells = row.map((c) => (c ?? "").toLowerCase());
  const idx = (terms: string[]) => cells.findIndex((c) => terms.some((t) => c.includes(t)));
  const date = idx(["date", "posted", "txn date", "trans date"]);
  const description = idx(["description", "details", "transaction", "memo", "particulars", "narration"]);
  const balance = idx(["balance"]);
  if (date < 0 || (description < 0 && balance < 0)) return null;
  return {
    date,
    description: description >= 0 ? description : null,
    debit: idx(["debit", "withdrawal", "amount out"]),
    credit: idx(["credit", "deposit", "amount in"]),
    amount: idx(["amount"]),
    balance: balance >= 0 ? balance : null,
  };
}

function findBankTransactionHeaderIndex(rows: string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const map = bankHeaderMap(rows[i]);
    if (!map) continue;
    const text = rows[i].join(" ").toLowerCase();
    const hasTxnDescription = map.description != null || /particulars|narration|description/.test(text);
    const hasMoneyFlow = map.debit != null || map.credit != null || /withdrawals?|deposits?/.test(text);
    if (map.date != null && hasTxnDescription && hasMoneyFlow && map.balance != null) return i;
  }
  return -1;
}

function detectNumericDateLocale(text: string, fallback: "US" | "EU"): "US" | "EU" {
  let dayFirst = 0;
  let monthFirst = 0;
  const re = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
  for (const m of text.matchAll(re)) {
    const a = +m[1];
    const b = +m[2];
    if (a > 12 && b <= 12) dayFirst += 1;
    if (b > 12 && a <= 12) monthFirst += 1;
  }
  if (dayFirst > monthFirst) return "EU";
  if (monthFirst > dayFirst) return "US";
  // Indian statements commonly use DD-MM-YYYY while amounts still use
  // comma-thousands + dot-decimals, so the money locale alone looks "US".
  if (/\b(INR|IFSC|MICR|ICICI|HDFC|AXIS|NEFT|RTGS|UPI|Savings\s+Account\s+Number)\b/i.test(text)) {
    return "EU";
  }
  return fallback;
}

function findDateInRow(
  row: string[],
  preferredIdx: number | null,
  locale: "US" | "EU",
  refYear?: number,
): { iso: string | null; raw: string; idx: number | null } {
  const candidates = [preferredIdx, 0, 1, 2]
    .filter((v, i, arr): v is number => v != null && v >= 0 && arr.indexOf(v) === i);
  for (const idx of candidates) {
    const raw = pick(row, idx);
    const iso = parseDate(raw, locale, refYear);
    if (iso) return { iso, raw, idx };
  }
  for (let idx = 0; idx < Math.min(row.length, 4); idx++) {
    const raw = pick(row, idx);
    const iso = parseDate(raw, locale, refYear);
    if (iso) return { iso, raw, idx };
  }
  return { iso: null, raw: "", idx: null };
}

function monetaryCells(row: string[], locale: "US" | "EU") {
  return row
    .map((raw, idx) => ({ idx, raw: raw ?? "", value: parseBankMoney(raw ?? "", locale) }))
    .filter((c): c is { idx: number; raw: string; value: number } => c.value != null);
}

function parseBankMoney(raw: string, locale: "US" | "EU"): number | null {
  const s = String(raw ?? "").trim();
  if (!s || /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(s)) return null;
  if (!/(?:[$€£¥]|\b(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}\b|\b\d+[,\.]\d{2}\s*(?:CR|DR)\b)/i.test(s)) {
    return null;
  }
  return parseAmount(s, locale).value;
}

function chooseBalanceCell(
  cells: ReturnType<typeof monetaryCells>,
  mappedIdx: number | null,
) {
  if (mappedIdx != null) {
    const exact = cells.find((c) => c.idx === mappedIdx || Math.abs(c.idx - mappedIdx) <= 1);
    if (exact) return exact;
  }
  return cells[cells.length - 1] ?? null;
}

function chooseTransactionAmountCell(
  cells: ReturnType<typeof monetaryCells>,
  balanceIdx: number | null,
  mapping: Record<string, number | null>,
) {
  const withoutBalance = cells.filter((c) => c.idx !== balanceIdx);
  for (const idx of [mapping.amount, mapping.debit, mapping.credit]) {
    if (idx == null) continue;
    const exact = withoutBalance.find((c) => c.idx === idx || Math.abs(c.idx - idx) <= 2);
    if (exact) return exact;
  }
  return withoutBalance[withoutBalance.length - 1] ?? null;
}

function signedBankAmount(
  cell: { idx: number; raw: string; value: number },
  balance: number | null,
  previousBalance: number | null,
  mapping: Record<string, number | null>,
): number {
  const abs = Math.abs(cell.value);
  if (/\bDR\b|\bdebit\b/i.test(cell.raw)) return -abs;
  if (/\bCR\b|\bcredit\b/i.test(cell.raw)) return abs;
  if (balance != null && previousBalance != null) {
    const delta = balance - previousBalance;
    if (Math.abs(Math.abs(delta) - abs) <= 0.02) return delta >= 0 ? abs : -abs;
  }
  if (mapping.credit != null && Math.abs(cell.idx - mapping.credit) <= 1) return abs;
  if (mapping.debit != null && Math.abs(cell.idx - mapping.debit) <= 1) return -abs;
  return cell.value < 0 ? cell.value : -abs;
}

function bankRowDescription(
  row: string[],
  mapping: Record<string, number | null>,
  amountIdx: number,
  balanceIdx: number | null,
): string {
  const limit = Math.min(amountIdx, balanceIdx ?? amountIdx);
  const parts: string[] = [];
  const mapped = pick(row, mapping.description).trim();
  for (let i = 0; i < row.length; i++) {
    if (i === amountIdx || i === balanceIdx) continue;
    const raw = (row[i] ?? "").trim();
    if (!raw) continue;
    if (i === mapping.date) continue;
    if (parseBankMoney(raw, "US") != null || parseBankMoney(raw, "EU") != null) continue;
    if (i <= limit || raw === mapped) parts.push(raw);
  }
  if (parts.length === 0 && mapped) parts.push(mapped);
  return cleanDescription(parts.join(" "));
}

function bankContinuationText(row: string[], mapping: Record<string, number | null>): string {
  const parts = row
    .map((c, i) => ({ c: (c ?? "").trim(), i }))
    .filter(({ c, i }) => c && i !== mapping.date && parseBankMoney(c, "US") == null && parseBankMoney(c, "EU") == null)
    .map(({ c }) => c);
  return cleanDescription(parts.join(" "));
}

function bankDateCellRemainder(raw: string): string {
  return String(raw ?? "")
    .replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/, "")
    .trim();
}

function cleanDescription(desc: string): string {
  return desc.replace(/\s+/g, " ").replace(/\s+([,/])/g, "$1").trim();
}

function looksBankTransactionStart(line: string): boolean {
  return /^(?:UPI|IMPS|NEFT|RTGS|INF|BIL|CMS|ACH|NACH|ECS|ATM|POS|VPS|VIN|MMT|NET\s+BANKING|MOBILE\s+BANKING|OTHER\s+ATMS|BY\s+CASH|CASH|CHQ|CHEQUE|REM(?:ITTANCE)?|SALARY|PAY|\d{6,}:)/i.test(line);
}

function isBankNoise(line: string): boolean {
  return /^(?:Page\s+\d+\s+of|MR\.|MRS\.|MS\.|Sincerely,?|Team\s+ICICI|This\s+is\s+a\s+system-generated|Legends\s+for|VAT\/MAT\/NFS|EBA\s+-|Summary\s+of\s+Accounts|ACCOUNT\s+DETAILS|ACCOUNT\s+TYPE|FIXED\s+DEPOSITS|DEPOSIT\s+NO\.|TOTAL\b|#\s*Deposit|Statement\s+of\s+Transactions|Did\s+you\s+know|branch\s+or\s+contact|Your\s+Base\s+Branch|Visit\s+www|Dial\s+your\s+Bank|DATE\s+MODE)/i.test(line);
}

function isBankTerminalNoise(line: string): boolean {
  return /\bACCOUNT\s+NUMBER\s+MICR\s+CODE\s+IFSC\s+CODE\b|\bCategory\s+of\s+service:\s*Banking\b|\bIn\s+absence\s+of\s+valid\s+PAN\b|\bForm\s+15G\s*\/\s*15H\b|\bIncome\s+tax\s+department\b|\bwww\.icicibank\.com\b/i.test(line);
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
