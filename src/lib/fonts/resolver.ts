// Centralized font resolver. Given any combination of PDF/CSS font hints,
// returns a canonical family plus weight/italic/confidence.
//
// Resolution order (highest → lowest confidence):
//   1. descriptor       — /FontName from the PDF FontDescriptor      (1.00)
//   2. postscriptName   — PostScript name from the font dictionary   (1.00)
//   3. pdfFamily        — /FontFamily entry                          (0.95)
//   4. cssFamily        — CSS font-family stack                      (0.90)
//   5. alias fuzzy pass — substring match across the alias table     (0.60)
//   6. generic fallback — best guess by kind (sans/serif/mono)       (0.20)

import { ALIASES } from "./aliases";
import { normalizePsName, toAliasKey, type NormalizedName } from "./normalize";
import { genericFor, getCanonical } from "./registry";
import type {
  CanonicalFont,
  FontQuery,
  ResolveResult,
  ResolveSource,
} from "./types";

const WEIGHT_KEYWORDS: Record<string, number> = {
  thin: 100, hairline: 100,
  extralight: 200, ultralight: 200,
  light: 300,
  regular: 400, normal: 400, book: 400, roman: 400,
  medium: 500,
  semibold: 600, demibold: 600, demi: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800, heavy: 800,
  black: 900,
};

function coerceWeight(hint: FontQuery["weightHint"]): number | undefined {
  if (hint == null) return undefined;
  if (typeof hint === "number" && hint >= 100 && hint <= 900) return Math.round(hint);
  const k = String(hint).trim().toLowerCase();
  if (/^\d+$/.test(k)) {
    const n = Number(k);
    if (n >= 100 && n <= 900) return n;
  }
  return WEIGHT_KEYWORDS[k];
}

function lookupAlias(key: string): string | undefined {
  if (!key) return undefined;
  return ALIASES[key];
}

// Try to resolve a single normalized name against the registry + alias table.
function matchNormalized(n: NormalizedName): { id: string; via: "base" | "alias" } | undefined {
  if (!n.base) return undefined;
  // Direct registry id match (e.g. slug "times-new-roman").
  if (n.slug && getCanonical(n.slug)) return { id: n.slug, via: "base" };
  const alias = lookupAlias(n.base);
  if (alias) return { id: alias, via: "alias" };
  return undefined;
}

// Fuzzy substring pass — pick the longest alias key contained in the token.
function fuzzyAlias(key: string): string | undefined {
  if (!key || key.length < 4) return undefined;
  let bestKey = "";
  let bestId: string | undefined;
  for (const aliasKey of Object.keys(ALIASES)) {
    if (aliasKey.length < 4) continue;
    if (key.includes(aliasKey) && aliasKey.length > bestKey.length) {
      bestKey = aliasKey;
      bestId = ALIASES[aliasKey];
    }
  }
  return bestId;
}

// Split a CSS font-family stack into individual tokens (stripped of quotes).
function splitCssStack(css: string): string[] {
  return css
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

function inferKindFromTokens(tokens: string[]): "sans" | "serif" | "mono" {
  const hay = tokens.join(" ").toLowerCase();
  if (/\bmono(space)?\b|courier|consolas|typewriter/.test(hay)) return "mono";
  if (/\bserif\b|times|georgia|cambria|garamond|book|palatino|century|minion|warnock|noto\s*serif/.test(hay)) return "serif";
  return "sans";
}

interface Attempt {
  font: CanonicalFont;
  source: ResolveSource;
  matchedKey: string;
  confidence: number;
  exact: true;
  normalized?: NormalizedName;
}

function tryDescriptor(raw: string | undefined): Attempt | undefined {
  if (!raw) return undefined;
  const n = normalizePsName(raw);
  const m = matchNormalized(n);
  if (!m) return undefined;
  const font = getCanonical(m.id);
  if (!font) return undefined;
  return { font, source: "descriptor", matchedKey: n.base, confidence: 1.0, exact: true, normalized: n };
}

function tryPostscript(raw: string | undefined): Attempt | undefined {
  if (!raw) return undefined;
  const n = normalizePsName(raw);
  const m = matchNormalized(n);
  if (!m) return undefined;
  const font = getCanonical(m.id);
  if (!font) return undefined;
  return { font, source: "postscript", matchedKey: n.base, confidence: 1.0, exact: true, normalized: n };
}

function tryPdfFamily(raw: string | undefined): Attempt | undefined {
  if (!raw) return undefined;
  const key = toAliasKey(raw);
  const direct = getCanonical(raw.trim().toLowerCase().replace(/\s+/g, "-"));
  if (direct) return { font: direct, source: "pdfFamily", matchedKey: key, confidence: 0.95, exact: true };
  const aliasId = lookupAlias(key);
  if (aliasId) {
    const font = getCanonical(aliasId);
    if (font) return { font, source: "pdfFamily", matchedKey: key, confidence: 0.95, exact: true };
  }
  return undefined;
}

function tryCssFamily(raw: string | undefined): Attempt | undefined {
  if (!raw) return undefined;
  const tokens = splitCssStack(raw);
  for (const token of tokens) {
    const key = toAliasKey(token);
    if (!key) continue;
    const slug = token.trim().toLowerCase().replace(/\s+/g, "-");
    const direct = getCanonical(slug);
    if (direct) return { font: direct, source: "cssFamily", matchedKey: key, confidence: 0.9, exact: true };
    const aliasId = lookupAlias(key);
    if (aliasId) {
      const font = getCanonical(aliasId);
      if (font) return { font, source: "cssFamily", matchedKey: key, confidence: 0.9, exact: true };
    }
  }
  return undefined;
}

function tryFuzzy(query: FontQuery): Attempt | undefined {
  const candidates: string[] = [];
  if (query.descriptor) candidates.push(query.descriptor);
  if (query.postscriptName) candidates.push(query.postscriptName);
  if (query.pdfFamily) candidates.push(query.pdfFamily);
  if (query.cssFamily) candidates.push(...splitCssStack(query.cssFamily));
  for (const c of candidates) {
    const n = normalizePsName(c);
    const key = n.base || toAliasKey(c);
    const aliasId = fuzzyAlias(key);
    if (aliasId) {
      const font = getCanonical(aliasId);
      if (font) {
        return { font, source: "alias", matchedKey: key, confidence: 0.6, exact: true, normalized: n };
      }
    }
  }
  return undefined;
}

export function resolveFont(query: FontQuery): ResolveResult {
  const attempt =
    tryDescriptor(query.descriptor) ||
    tryPostscript(query.postscriptName) ||
    tryPdfFamily(query.pdfFamily) ||
    tryCssFamily(query.cssFamily) ||
    tryFuzzy(query);

  // Collect weight/italic from the normalized name that produced the match,
  // and from any other supplied field, so callers get useful style info
  // even when the winning source didn't carry it.
  const normalizedSources = [
    query.descriptor,
    query.postscriptName,
    query.pdfFamily,
  ].filter(Boolean) as string[];
  const norms = normalizedSources.map(normalizePsName);
  const detectedWeight = norms.find((n) => n.styleTokens.some((t) => t in WEIGHT_KEYWORDS))?.weight;
  const detectedItalic = norms.some((n) => n.italic);

  const hintWeight = coerceWeight(query.weightHint);
  const weight =
    hintWeight ??
    detectedWeight ??
    (attempt?.normalized?.weight ?? 400);
  const italic = query.italicHint ?? detectedItalic ?? attempt?.normalized?.italic ?? false;

  if (attempt) {
    return {
      font: attempt.font,
      weight,
      italic,
      bold: weight >= 600,
      confidence: attempt.confidence,
      exact: true,
      source: attempt.source,
      matchedKey: attempt.matchedKey,
    };
  }

  // Generic fallback — infer kind from any tokens we have.
  const tokens: string[] = [];
  if (query.cssFamily) tokens.push(...splitCssStack(query.cssFamily));
  if (query.pdfFamily) tokens.push(query.pdfFamily);
  if (query.postscriptName) tokens.push(query.postscriptName);
  if (query.descriptor) tokens.push(query.descriptor);
  const kind = inferKindFromTokens(tokens);
  const font = genericFor(kind);

  return {
    font,
    weight,
    italic,
    bold: weight >= 600,
    confidence: 0.2,
    exact: false,
    source: "generic",
  };
}
