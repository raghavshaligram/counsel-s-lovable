/**
 * Agent flow detector — deterministic, keyword-first classifier that
 * decides whether the user's raw command bar text should trigger a
 * guided multi-step flow (agent) or fall back to the semantic intent
 * router.
 *
 * We KEEP the existing MiniLM/intent router untouched. This layer is a
 * fast first-pass: only phrases that clearly describe a "do this whole
 * thing for me" request map to a flow. Everything else falls through.
 */

import type { PiiCategory } from "@/lib/pdf/detect-pii";

export type FlowKind =
  | "detect-redact"
  | "pattern-redact"
  | "sanitize"
  | "bates"
  | "ocr"
  | "repair"
  | "search"
  | "split"
  | "exhibit-binder"
  | "ambiguous"
  | "answer";

export type AgentFlow =
  | {
      kind: "detect-redact";
      /** Filter to these PII categories, or null for "everything". */
      categories: PiiCategory[] | null;
      /** Optional page-scope, 1-based. Populated by mid-flow "only page 3". */
      pages?: number[];
      raw: string;
    }
  | { kind: "pattern-redact"; term: string; raw: string }
  | { kind: "sanitize"; raw: string }
  | { kind: "bates"; raw: string }
  | { kind: "ocr"; raw: string }
  | { kind: "repair"; raw: string }
  | { kind: "search"; term: string; raw: string }
  | { kind: "split"; raw: string }
  | { kind: "exhibit-binder"; raw: string }
  | {
      kind: "ambiguous";
      raw: string;
      /** Human prompt for the disambiguation card. */
      prompt: string;
      /** Candidate flows to offer as buttons. */
      choices: AgentFlow[];
    }
  | { kind: "answer"; query: string; raw: string };

/* ---------- category vocabulary ---------- */

const CAT_WORDS: Array<[RegExp, PiiCategory]> = [
  [/\bssns?\b|\bsocial(?:\s+security)?(?:\s+numbers?)?\b/i, "ssn"],
  [/\bemails?\b|\be-?mail\s+addresses?\b/i, "email"],
  [/\bphones?\b|\bphone\s+numbers?\b|\btelephone\b/i, "phone"],
  [/\b(?:credit|debit)?\s*cards?\b|\baccount\s+numbers?\b/i, "creditCard"],
  [/\bibans?\b/i, "iban"],
  [/\bdates?\b|\bdobs?\b|\bdates?\s+of\s+birth\b/i, "date"],
  [/\bnames?\b|\bperson\s+names?\b|\bpeople\b/i, "name"],
  [/\borgs?\b|\bcompanies\b|\borganizations?\b/i, "org"],
  [/\bips?\b|\bip\s+addresses?\b/i, "ipAddress"],
];

function pickCategories(raw: string): PiiCategory[] | null {
  const hits: PiiCategory[] = [];
  for (const [re, cat] of CAT_WORDS) if (re.test(raw)) hits.push(cat);
  if (hits.length === 0) return null;
  return Array.from(new Set(hits));
}

/* ---------- main detector ---------- */

const REDACT_VERB = /\bredact(?:ing|ion|ions)?\b|\bblack\s*out\b|\bstrike\s*through\b/i;
const FIND_VERB = /\bfind\b|\blocate\b|\bshow\s+me\b|\bwhere\s+(?:is|are)\b|\bsearch(?:\s+(?:for|the))?\b/i;
const DETECT_VERB = /\bdetect\b|\bscan(?:\s+for)?\b|\bidentify\b/i;
const SENSITIVE = /\bpii\b|\bsensitive(?:\s+(?:info(?:rmation)?|data))?\b|\bpersonal\s+(?:info|data)\b/i;

const SANITIZE = /\bsanitize\b|\bstrip(?:\s+metadata)?\b|\bscrub\b|\bmetadata\b|\bhidden\s+data\b|\brevision\s+history\b/i;
const BATES = /\bbates\b/i;
const OCR = /\bocr\b|\bmake\s+(?:it\s+)?searchable\b|\brecognize\s+text\b|\bscanned\s+(?:pdf|doc)/i;
const REPAIR = /\brepair\b|\bfix\s+(?:the\s+)?pdf\b|\bcorrupt(?:ed)?\b|\bbroken\s+pdf\b/i;

// Split intent: only when the verb clearly means "split this document"
// — not any occurrence of "split". Requires a subject like "pdf", "doc",
// "file", "this", "into", "every N pages", "at blank pages".
const SPLIT = /\bsplit\s+(?:this|the|my|pdf|doc(?:ument)?|file|into|at|every)\b|\bsplit\s+it\b|\bsmart\s+split(?:ter)?\b|\bdocument\s+splitter\b/i;

// Exhibit binder: requires an explicit "assemble/create/build/make …
// (exhibit )?binder" phrasing. A bare mention of "exhibit" NEVER
// triggers this — that would swallow every "find exhibit" query.
const EXHIBIT_BINDER =
  /\b(?:assemble|create|build|make|generate|compile|produce)\b[^\n]{0,40}\b(?:exhibit\s+)?binder\b|\bexhibit\s+binder\b/i;

const QUESTION = /^(what|who|when|where|why|how|explain|summari[sz]e|tell\s+me|is\s+this|does\s+this)\b/i;

const QUOTED_TERM = /["'“”‘’]([^"'“”‘’]{1,80})["'“”‘’]/;

const STOPWORDS = new Set([
  "the","a","an","this","that","these","those","my","our","some","any",
  "please","pls","kindly","just","really","doc","document","pdf","file",
  "in","on","of","for","to","at","and","or",
]);

/** Extract the search term after a find/search/where verb. */
function extractSearchTerm(raw: string): string | null {
  const quoted = raw.match(QUOTED_TERM);
  if (quoted && quoted[1].trim()) return quoted[1].trim();
  const m = raw.match(
    /\b(?:find|locate|search(?:\s+for)?|show\s+me|where\s+(?:is|are))\s+(.+)$/i,
  );
  if (!m) return null;
  let term = m[1].trim().replace(/[?.!,;:]+$/, "").trim();
  // Strip leading determiners/junk words so "find the exhibit" → "exhibit".
  const tokens = term.split(/\s+/);
  while (tokens.length > 1 && STOPWORDS.has(tokens[0].toLowerCase())) tokens.shift();
  term = tokens.join(" ").trim();
  if (!term || term.length > 120) return null;
  // Bare pronoun like "it" — not a real term.
  if (/^(it|them|these|those|things?)$/i.test(term)) return null;
  return term;
}

/** Return an AgentFlow if the input clearly matches one; else null. */
export function detectAgentFlow(input: string): AgentFlow | null {
  const raw = input.trim();
  if (!raw) return null;

  // 1) Pattern redact: quoted term with redact verb — highest specificity.
  if (REDACT_VERB.test(raw)) {
    const q = raw.match(QUOTED_TERM);
    if (q && q[1].trim()) {
      return { kind: "pattern-redact", term: q[1].trim(), raw };
    }
  }

  const cats = pickCategories(raw);
  const wantsRedact = REDACT_VERB.test(raw);
  const wantsDetectPII = DETECT_VERB.test(raw) || SENSITIVE.test(raw);
  const wantsFind = FIND_VERB.test(raw);

  // 2) Find & redact PII (destructive-intent) — requires an explicit
  //    PII category OR the word "sensitive"/"pii"/"personal info".
  //    "find exhibit" does NOT match — no category and no "sensitive".
  if ((wantsRedact || wantsDetectPII) && (cats || SENSITIVE.test(raw))) {
    return { kind: "detect-redact", categories: cats, raw };
  }

  // 3) Explicit "find sensitive/PII" without a specific category.
  if (wantsFind && (cats || SENSITIVE.test(raw))) {
    return { kind: "detect-redact", categories: cats, raw };
  }

  // 4) Tool-specific verbs (require their own dedicated regex).
  if (SANITIZE.test(raw)) return { kind: "sanitize", raw };
  if (BATES.test(raw)) return { kind: "bates", raw };
  if (OCR.test(raw)) return { kind: "ocr", raw };
  if (REPAIR.test(raw)) return { kind: "repair", raw };
  if (SPLIT.test(raw)) return { kind: "split", raw };
  if (EXHIBIT_BINDER.test(raw)) return { kind: "exhibit-binder", raw };

  // 5) Redact verb without a category and without a quoted term is
  //    ambiguous — ask instead of silently scanning everything.
  if (wantsRedact) {
    return {
      kind: "ambiguous",
      raw,
      prompt:
        "Redact what? Pick a category or type a term to redact (e.g. 'redact SSNs' or 'redact \"John Smith\"').",
      choices: [
        { kind: "detect-redact", categories: ["ssn"], raw },
        { kind: "detect-redact", categories: ["email"], raw },
        { kind: "detect-redact", categories: null, raw },
      ],
    };
  }

  // 6) Search intent: "find X", "search for X", "where is X" — with a
  //    real term and NO PII category / sensitive keyword. Route to the
  //    Pre-Discovery search panel; do NOT run a detection scan.
  if (wantsFind) {
    const term = extractSearchTerm(raw);
    if (term) return { kind: "search", term, raw };
    return {
      kind: "ambiguous",
      raw,
      prompt:
        "What would you like me to find? Add a term (e.g. 'find SSNs', 'find exhibit A') or ask a question.",
      choices: [
        { kind: "detect-redact", categories: null, raw },
        { kind: "answer", query: raw, raw },
      ],
    };
  }

  // 7) Bare detection verb ("scan", "detect") with no target → ambiguous.
  if (wantsDetectPII) {
    return {
      kind: "ambiguous",
      raw,
      prompt:
        "Scan for what? Try 'scan for SSNs', 'find sensitive info', or 'find phone numbers'.",
      choices: [{ kind: "detect-redact", categories: null, raw }],
    };
  }

  // 8) Question / help → route to Pre-Discovery Q&A.
  if (QUESTION.test(raw) || raw.endsWith("?")) {
    return { kind: "answer", query: raw, raw };
  }

  return null;
}

/* ---------- mid-flow re-scoping helpers ---------- */

/** Parse "only page 3", "just pages 4-7" — returns 1-based page numbers or null. */
export function parsePageScope(input: string): number[] | null {
  const m = input.match(/\bpages?\s+([\d,\s\-–]+)/i);
  if (!m) return null;
  const out = new Set<number>();
  for (const part of m[1].split(/[,\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let i = lo; i <= hi; i++) out.add(i);
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part));
    }
  }
  const arr = Array.from(out).sort((a, b) => a - b);
  return arr.length > 0 ? arr : null;
}

/** Detect a cancel intent in a mid-flow follow-up. */
export function isCancel(input: string): boolean {
  return /^(cancel|stop|nevermind|never\s+mind|abort|no)\b/i.test(input.trim());
}

/** Detect "also find phone numbers" style additions. */
export function extractAdditionalCategories(input: string): PiiCategory[] | null {
  if (!/\balso\b|\band\b|\bplus\b|\btoo\b/i.test(input)) return null;
  return pickCategories(input);
}

/* ---------- flow → target tool for handoff ---------- */

export function targetToolForFlow(flow: AgentFlow): string | null {
  switch (flow.kind) {
    case "detect-redact":
    case "pattern-redact":
      return "redact";
    case "sanitize":
      return "sanitize";
    case "bates":
      return "bates";
    case "ocr":
      return "ocr";
    case "repair":
      return "repair";
    case "split":
      return "split";
    case "exhibit-binder":
      return "exhibit-binder";
    case "search":
    case "answer":
      return "pre-discovery";
    case "ambiguous":
      return null;
  }
}

