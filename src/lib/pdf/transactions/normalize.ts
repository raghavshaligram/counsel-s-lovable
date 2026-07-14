// Locale-aware amount/date normalizers used by every parser.

import type { Locale } from "./types";

export type Amount = {
  value: number | null;
  negative: boolean;
  currency?: string;
};

const CUR: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
};

export function parseAmount(raw: string, locale: Locale = "US"): Amount {
  if (raw == null) return { value: null, negative: false };
  let s = String(raw).trim();
  if (!s) return { value: null, negative: false };

  let currency: string | undefined;
  for (const sym of Object.keys(CUR)) {
    if (s.includes(sym)) {
      currency = CUR[sym];
      s = s.replace(sym, "");
      break;
    }
  }

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\b(DR|debit)\b/i.test(s)) negative = true;
  if (/\b(CR|credit)\b/i.test(s)) negative = false;
  s = s.replace(/\b(DR|CR|debit|credit)\b/gi, "").trim();

  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/[^\d,.\-]/g, "");
  if (!/\d/.test(s)) return { value: null, negative, currency };

  // Detect decimal separator
  let dec = ".";
  if (locale === "EU") dec = ",";
  else {
    // Auto-detect: last separator wins
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) dec = ",";
  }
  const thou = dec === "." ? "," : ".";
  s = s.split(thou).join("");
  if (dec === ",") s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, negative, currency };
  return { value: negative ? -Math.abs(n) : n, negative, currency };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Returns ISO YYYY-MM-DD or null. */
export function parseDate(raw: string, locale: Locale = "US", refYear?: number): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD
  let m = s.match(/\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  // Numeric MM/DD/YY(YY) or DD/MM/YY(YY)
  m = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m) {
    let a = +m[1], b = +m[2];
    const y = expandYear(+m[3]);
    let month: number, day: number;
    if (locale === "EU") {
      day = a; month = b;
    } else {
      month = a; day = b;
    }
    // Sanity swap if month > 12
    if (month > 12 && day <= 12) { const t = month; month = day; day = t; }
    return iso(y, month, day);
  }

  // "Jan 5, 2024" / "5 Jan 2024" / "Jan 5"
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{2,4}))?\b/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) {
      const day = +m[2];
      const y = m[3] ? expandYear(+m[3]) : (refYear ?? new Date().getFullYear());
      return iso(y, mo, day);
    }
  }
  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(\d{2,4}))?\b/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      const day = +m[1];
      const y = m[3] ? expandYear(+m[3]) : (refYear ?? new Date().getFullYear());
      return iso(y, mo, day);
    }
  }
  return null;
}

function expandYear(y: number): number {
  if (y >= 1000) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}
function iso(y: number, m: number, d: number): string | null {
  if (!m || !d || m > 12 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function guessLocale(pageText: string): Locale {
  const t = pageText || "";
  const eur = (t.match(/€|£/g) ?? []).length;
  const usd = (t.match(/\$/g) ?? []).length;
  if (eur > usd * 1.5) return "EU";
  // Decimal-separator sample: numbers like 1.234,56 vs 1,234.56
  const euNum = (t.match(/\d\.\d{3},\d{2}/g) ?? []).length;
  const usNum = (t.match(/\d,\d{3}\.\d{2}/g) ?? []).length;
  if (euNum > usNum) return "EU";
  return "US";
}

export function looksNumeric(s: string): boolean {
  if (!s) return false;
  const cleaned = String(s).replace(/[\s$€£¥()DRCR,.\-]/gi, "");
  return /^\d+$/.test(cleaned) && String(s).match(/\d/) !== null;
}
