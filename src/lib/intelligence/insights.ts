/**
 * Document Insights — the intelligence layer.
 *
 * Runs lightweight, in-browser pattern analysis on the first N pages of a
 * loaded PDF and produces a small set of `Insight`s. Each insight names a
 * concrete next action the user can take (which tool to open, with what
 * pre-filled state). The Suggestions Strip and Command Palette both read
 * from this list.
 *
 * 100% client-side. No model calls. No network. Heuristics only — the AI
 * agent in /workspace is where deeper analysis happens, with the user's
 * own key, after approval.
 */

export type InsightKind =
  | "ssn"
  | "email"
  | "phone"
  | "card"
  | "money"
  | "table"
  | "scanned"
  | "names"
  | "dates";

export type Insight = {
  id: string;
  kind: InsightKind;
  label: string;        // human chip text, e.g. "3 SSNs"
  hint: string;         // tooltip / palette hint
  count: number;
  severity: "info" | "warn" | "evidence";
  /** Tool id in /workspace?tool=… that this insight maps to. */
  suggestedTool: "redact" | "extract" | "ocr" | "bates" | "sign";
  /** First page where the pattern appeared (for jump-to). */
  firstPage: number;
};

const RX = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  card: /\b(?:\d[ -]?){13,16}\b/g,
  money: /\$\s?\d[\d,]*(?:\.\d{2})?/g,
  date: /\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/g,
  // Crude proper-name pair detector: two capitalized words in a row.
  name: /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g,
};

type PdfPageLike = {
  getTextContent(): Promise<{ items: Array<{ str: string; transform?: number[] }> }>;
};

type PdfLike = {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
};

/**
 * Analyze up to `maxPages` of a pdfjs document and return suggested actions.
 * Designed to take well under a second on typical legal/finance PDFs.
 */
export async function analyzeDocument(pdf: PdfLike, maxPages = 10): Promise<Insight[]> {
  const limit = Math.min(maxPages, pdf.numPages);
  const counts: Record<InsightKind, { n: number; firstPage: number }> = {
    ssn: { n: 0, firstPage: 0 },
    email: { n: 0, firstPage: 0 },
    phone: { n: 0, firstPage: 0 },
    card: { n: 0, firstPage: 0 },
    money: { n: 0, firstPage: 0 },
    table: { n: 0, firstPage: 0 },
    scanned: { n: 0, firstPage: 0 },
    names: { n: 0, firstPage: 0 },
    dates: { n: 0, firstPage: 0 },
  };

  for (let i = 1; i <= limit; i++) {
    let page: PdfPageLike;
    try {
      page = await pdf.getPage(i);
    } catch {
      continue;
    }
    const content = await page.getTextContent().catch(() => ({ items: [] }));
    const items = content.items as Array<{ str: string; transform?: number[] }>;
    const text = items.map((it) => it.str).join(" ");

    // Scanned-page heuristic: PDF page with no extractable text.
    if (text.trim().length < 20) {
      bump(counts, "scanned", i);
      continue;
    }

    // Table-likely heuristic: many short text runs lined up at distinct y-coords.
    const yBuckets = new Set<number>();
    let shortRuns = 0;
    for (const it of items) {
      if (it.str.length <= 8) shortRuns++;
      if (it.transform && it.transform.length >= 6) yBuckets.add(Math.round(it.transform[5]));
    }
    if (shortRuns > 20 && yBuckets.size > 8) bump(counts, "table", i);

    countMatches(text, RX.ssn, "ssn", counts, i);
    countMatches(text, RX.email, "email", counts, i);
    countMatches(text, RX.phone, "phone", counts, i);
    // luhn-check candidate cards
    const cardMatches = text.match(RX.card) ?? [];
    for (const c of cardMatches) {
      const digits = c.replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 16 && luhn(digits)) bump(counts, "card", i);
    }
    countMatches(text, RX.money, "money", counts, i);
    countMatches(text, RX.date, "dates", counts, i);
    countMatches(text, RX.name, "names", counts, i);
  }

  const out: Insight[] = [];
  if (counts.scanned.n > 0)
    out.push({
      id: "scanned",
      kind: "scanned",
      label: `${counts.scanned.n} scanned ${plural("page", counts.scanned.n)}`,
      hint: "No text layer detected — run OCR to make them searchable & redactable.",
      count: counts.scanned.n,
      severity: "warn",
      suggestedTool: "ocr",
      firstPage: counts.scanned.firstPage,
    });
  if (counts.ssn.n > 0)
    out.push({
      id: "ssn",
      kind: "ssn",
      label: `${counts.ssn.n} SSN${counts.ssn.n === 1 ? "" : "s"}`,
      hint: "Social-security numbers detected — propose redactions.",
      count: counts.ssn.n,
      severity: "evidence",
      suggestedTool: "redact",
      firstPage: counts.ssn.firstPage,
    });
  if (counts.card.n > 0)
    out.push({
      id: "card",
      kind: "card",
      label: `${counts.card.n} card ${plural("number", counts.card.n)}`,
      hint: "Likely payment-card numbers (Luhn-valid) — propose redactions.",
      count: counts.card.n,
      severity: "evidence",
      suggestedTool: "redact",
      firstPage: counts.card.firstPage,
    });
  if (counts.email.n > 0)
    out.push({
      id: "email",
      kind: "email",
      label: `${counts.email.n} email${counts.email.n === 1 ? "" : "s"}`,
      hint: "Email addresses found — review for redaction.",
      count: counts.email.n,
      severity: "warn",
      suggestedTool: "redact",
      firstPage: counts.email.firstPage,
    });
  if (counts.phone.n > 0)
    out.push({
      id: "phone",
      kind: "phone",
      label: `${counts.phone.n} phone ${plural("number", counts.phone.n)}`,
      hint: "Phone numbers found — review for redaction.",
      count: counts.phone.n,
      severity: "info",
      suggestedTool: "redact",
      firstPage: counts.phone.firstPage,
    });
  if (counts.table.n > 0)
    out.push({
      id: "table",
      kind: "table",
      label: `${counts.table.n} table ${plural("page", counts.table.n)}`,
      hint: "Tabular layout detected — extract to CSV / XLSX.",
      count: counts.table.n,
      severity: "info",
      suggestedTool: "extract",
      firstPage: counts.table.firstPage,
    });
  if (counts.money.n > 5)
    out.push({
      id: "money",
      kind: "money",
      label: `${counts.money.n} monetary values`,
      hint: "Looks like a statement or invoice — extract figures.",
      count: counts.money.n,
      severity: "info",
      suggestedTool: "extract",
      firstPage: counts.money.firstPage,
    });
  if (counts.names.n > 3)
    out.push({
      id: "names",
      kind: "names",
      label: `${counts.names.n} named ${plural("entity", counts.names.n, "entities")}`,
      hint: "Many proper names — consider Bates numbering for production.",
      count: counts.names.n,
      severity: "info",
      suggestedTool: "bates",
      firstPage: counts.names.firstPage,
    });

  return out;
}

function bump(
  c: Record<InsightKind, { n: number; firstPage: number }>,
  k: InsightKind,
  page: number,
) {
  if (c[k].n === 0) c[k].firstPage = page - 1;
  c[k].n += 1;
}

function countMatches(
  text: string,
  rx: RegExp,
  k: InsightKind,
  c: Record<InsightKind, { n: number; firstPage: number }>,
  page: number,
) {
  const m = text.match(rx);
  if (!m || m.length === 0) return;
  if (c[k].n === 0) c[k].firstPage = page - 1;
  c[k].n += m.length;
}

function plural(s: string, n: number, alt?: string) {
  if (n === 1) return s;
  return alt ?? `${s}s`;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}
