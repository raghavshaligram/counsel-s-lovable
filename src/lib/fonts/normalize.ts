// Pure PostScript / PDF font-name normalization. No I/O, no side effects.
//
// Handles the common vendor suffixes and subset prefixes that appear in real
// PDFs:
//   ABCDEF+ArialMT              → base="arial",             weight=400, italic=false
//   Arial-BoldMT                → base="arial",             weight=700, italic=false
//   HelveticaNeueLTStd-Roman    → base="helveticaneue",     weight=400, italic=false
//   TimesNewRomanPSMT           → base="timesnewroman",     weight=400, italic=false
//   TimesNewRomanPS-BoldItalicMT→ base="timesnewroman",     weight=700, italic=true
//   SegoeUI-SemiboldItalic      → base="segoeui",           weight=600, italic=true

export interface NormalizedName {
  /** Lowercase, alphanumeric-only family key (no vendor suffix, no style). */
  base: string;
  /** Hyphen-joined variant of `base` split on camelCase word boundaries. */
  slug: string;
  weight: number;
  italic: boolean;
  /** Style tokens that were pulled off the tail (for diagnostics). */
  styleTokens: string[];
}

const SUBSET_PREFIX = /^[A-Z]{6}\+/;

// Vendor suffixes that appear attached to the family name and should be
// stripped before matching. Order matters: strip the longest first.
const VENDOR_SUFFIXES = [
  "PSMT",
  "LTStd",
  "Std",
  "LT",
  "PS",
  "MT",
];

const WEIGHT_MAP: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  roman: 400,
  book: 400,
  normal: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  demi: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  heavy: 800,
  black: 900,
};

const ITALIC_TOKENS = new Set(["italic", "oblique", "it"]);

// Split "TimesNewRomanPS" into ["Times", "New", "Roman", "PS"] so we can
// process camelCase names the same way as hyphen-separated names.
function splitCamel(input: string): string[] {
  if (!input) return [];
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s\-_,]+/)
    .filter(Boolean);
}

function stripVendorSuffix(token: string): string {
  let cur = token;
  // Strip repeatedly — e.g. "TimesNewRomanPSMT" contains both PS and MT.
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const suf of VENDOR_SUFFIXES) {
      if (cur.length > suf.length && cur.endsWith(suf)) {
        cur = cur.slice(0, -suf.length);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return cur;
}

/**
 * Normalize a PostScript / PDF font name into a family key plus weight/italic.
 * Never throws — returns { base: "", ... } for empty input.
 */
export function normalizePsName(raw: string | undefined | null): NormalizedName {
  const empty: NormalizedName = { base: "", slug: "", weight: 400, italic: false, styleTokens: [] };
  if (!raw) return empty;
  let s = String(raw).trim();
  if (!s) return empty;
  s = s.replace(SUBSET_PREFIX, "");

  // Split on hyphen/underscore/comma first — the style suffix is usually
  // separated by a hyphen ("Arial-BoldMT", "TimesNewRomanPS-BoldItalicMT").
  const segments = s.split(/[\-_,]/).map((seg) => seg.trim()).filter(Boolean);
  if (segments.length === 0) return empty;

  // Strip vendor suffixes from every segment.
  const cleaned = segments.map(stripVendorSuffix).filter(Boolean);
  if (cleaned.length === 0) return empty;

  // Peel style tokens off the tail. The last segment may itself be
  // camelCased ("SemiboldItalic") — expand it before matching.
  let weight = 400;
  let italic = false;
  let weightSet = false;
  const styleTokens: string[] = [];
  const familyTokens: string[] = [];

  const isStyleToken = (t: string): boolean => {
    const k = t.toLowerCase();
    return k in WEIGHT_MAP || ITALIC_TOKENS.has(k);
  };

  const consumeStyle = (t: string) => {
    const k = t.toLowerCase();
    if (k in WEIGHT_MAP) {
      weight = WEIGHT_MAP[k];
      weightSet = true;
      styleTokens.push(k);
    } else if (ITALIC_TOKENS.has(k)) {
      italic = true;
      styleTokens.push(k);
    }
  };

  // Walk segments left→right, appending to family until we hit a segment
  // that is entirely style tokens.
  for (let i = 0; i < cleaned.length; i++) {
    const seg = cleaned[i];
    const parts = splitCamel(seg);
    const allStyle = parts.length > 0 && parts.every(isStyleToken);
    if (allStyle && i > 0) {
      parts.forEach(consumeStyle);
    } else {
      familyTokens.push(...parts);
    }
  }

  // Trim trailing style tokens that leaked into the family (e.g. a name
  // like "AptosDisplayBold" without a hyphen). Restrict to unambiguous
  // style words — never pop "Roman" / "Book" / "Regular" / "Normal" because
  // they appear inside real family names ("Times New Roman", "Book Antiqua").
  const strongStyleTail = new Set([
    "thin", "hairline", "extralight", "ultralight", "light",
    "medium", "semibold", "demibold", "demi", "bold",
    "extrabold", "ultrabold", "heavy", "black",
    "italic", "oblique", "it",
  ]);
  while (
    familyTokens.length > 1 &&
    strongStyleTail.has(familyTokens[familyTokens.length - 1].toLowerCase())
  ) {
    consumeStyle(familyTokens.pop() as string);
  }

  if (familyTokens.length === 0) return { ...empty, weight, italic, styleTokens };

  const lowerTokens = familyTokens.map((t) => t.toLowerCase());
  const base = lowerTokens.join("").replace(/[^a-z0-9]/g, "");
  const slug = lowerTokens.join("-").replace(/[^a-z0-9-]/g, "");

  return {
    base,
    slug,
    weight: weightSet ? weight : 400,
    italic,
    styleTokens,
  };
}

/** Canonicalize an arbitrary token to the alias-table key format. */
export function toAliasKey(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}
