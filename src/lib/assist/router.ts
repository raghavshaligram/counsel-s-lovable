import { embedTexts } from "@/lib/discovery/client";
import {
  ASSIST_KNOWLEDGE_BASE,
  ASSIST_TOPICS,
  type AssistToolEntry,
  type AssistTopicEntry,
} from "./knowledge-base";
import {
  normalizeQueryKey,
  preferredToolFor,
  preferredLaneFor,
} from "./learn";

export type AssistMode = "help" | "open" | "use";
export type AssistLane = "literal" | "semantic" | "action" | "help";

export interface AssistCtx {
  lastEntryId?: string;
  lastTopicId?: string;
  lastQuery?: string;
  lastLane?: AssistLane;
  lastFindTerm?: string;
  lastFindMatches?: { page: number; snippet: string }[];
}

export type AssistClassification =
  | {
      kind: "tool";
      entry: AssistToolEntry;
      mode: AssistMode;
      score: number;
      runnerUp?: { entry: AssistToolEntry; score: number };
      corrected?: { from: string; to: string };
      followUp?: boolean;
      contextFrom?: string;
      /** For "redact them" follow-ups after a literal find. */
      stagedTerm?: string;
    }
  | {
      kind: "topic";
      topic: AssistTopicEntry;
      score: number;
      followUp?: boolean;
      contextFrom?: string;
    }
  | {
      kind: "literal";
      term: string;
      wholeWord: boolean;
      regex: boolean;
      reason: string;
      /** Alternate lanes offered as chips when the query is plausibly ambiguous. */
      alternates?: Array<{ lane: AssistLane; label: string }>;
    }
  | {
      kind: "semantic";
      query: string;
      reason: string;
      alternates?: Array<{ lane: AssistLane; label: string }>;
    }
  | {
      kind: "clarify";
      reason: string;
      options: AssistToolEntry[];
      score: number;
    }
  | {
      kind: "clarify-typo";
      original: string;
      suggestions: AssistToolEntry[];
    }
  | {
      /**
       * Directed follow-up: we recognized WHAT the user is talking about
       * (a PII noun, an unhandled verb + noun) but not WHICH lane to run.
       * The panel renders `question` + `choices` as chips.
       */
      kind: "clarify-ask";
      reason: string;
      question: string;
      /** For learn: normalized query key + optional noun for lane-pref learning. */
      queryKey: string;
      nounKey?: string;
      choices: Array<{
        id: string;
        label: string;
        lane: AssistLane;
        toolId?: string;
        /** For literal lanes: the search term to prefill. */
        term?: string;
        /** For action lanes (e.g. "Redact all"): the tool to open. */
        actionToolId?: string;
        /** Countable mode for literal — show N matches summary card. */
        countOnly?: boolean;
      }>;
    };





type AnchorIndex = {
  dim: number;
  matrix: Float32Array;
  owners: { kind: "tool" | "topic"; idx: number }[];
};

let anchorPromise: Promise<AnchorIndex> | null = null;

function anchorTextsFor(entry: AssistToolEntry): string[] {
  return [
    entry.displayName,
    entry.capabilitySummary,
    ...entry.aliases,
    ...entry.examples,
  ];
}

function anchorTextsForTopic(topic: AssistTopicEntry): string[] {
  return [topic.displayName, ...topic.aliases, ...topic.examples];
}

function buildAnchors(): Promise<AnchorIndex> {
  if (anchorPromise) return anchorPromise;
  anchorPromise = (async () => {
    const texts: string[] = [];
    const owners: AnchorIndex["owners"] = [];
    ASSIST_KNOWLEDGE_BASE.forEach((entry, idx) => {
      anchorTextsFor(entry).forEach((t) => {
        texts.push(t);
        owners.push({ kind: "tool", idx });
      });
    });
    ASSIST_TOPICS.forEach((topic, idx) => {
      anchorTextsForTopic(topic).forEach((t) => {
        texts.push(t);
        owners.push({ kind: "topic", idx });
      });
    });
    const vecs = await embedTexts(texts, "ai-assist:build-training-doc-anchors");
    const dim = vecs[0]?.length ?? 0;
    const matrix = new Float32Array(dim * vecs.length);
    vecs.forEach((vec, idx) => matrix.set(vec, idx * dim));
    console.info("[ai-assist] anchors ready", {
      tools: ASSIST_KNOWLEDGE_BASE.length,
      topics: ASSIST_TOPICS.length,
      anchors: vecs.length,
      dim,
    });
    return { dim, matrix, owners };
  })();
  return anchorPromise;
}

function dot(q: Float32Array, matrix: Float32Array, offset: number, dim: number) {
  let s = 0;
  for (let i = 0; i < dim; i++) s += q[i] * matrix[offset + i];
  return s;
}

const HELP_RE = /\b(what|whats|what's|how|why|explain|describe|tell\s+me|help|does|do\s+i|can\s+i|when\s+(?:should|to)|which|difference|meaning|define|definition|purpose)\b/i;
const OPEN_RE = /^\s*(open|show|go\s+to|take\s+me\s+to|launch)\b/i;
const USE_RE = /\b(add|apply|run|scan|detect|find|search|ask|summari[sz]e|redact|black\s*out|stamp|split|merge|combine|sanitize|scrub|ocr|repair|protect|unlock|sign|fill|convert|hash|compute|generate|build|assemble|create|watermark|number)\b/i;

function inferMode(raw: string): AssistMode {
  if (HELP_RE.test(raw)) return "help";
  if (OPEN_RE.test(raw)) return "open";
  if (USE_RE.test(raw)) return "use";
  return "help";
}

function fallbackOptions(ranked: Array<{ owner: AnchorIndex["owners"][0]; score: number }>): AssistToolEntry[] {
  const out: AssistToolEntry[] = [];
  for (const item of ranked) {
    if (item.owner.kind !== "tool") continue;
    const entry = ASSIST_KNOWLEDGE_BASE[item.owner.idx];
    if (entry && !out.some((e) => e.id === entry.id)) out.push(entry);
    if (out.length >= 2) break;
  }
  if (out.length < 2) {
    for (const entry of ASSIST_KNOWLEDGE_BASE) {
      if (!out.some((e) => e.id === entry.id)) out.push(entry);
      if (out.length >= 2) break;
    }
  }
  return out;
}

const MIN_SCORE = 0.42;
const CLARIFY_GAP = 0.035;
const CONTEXT_BOOST = 0.05;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function exactToolMatch(raw: string): AssistToolEntry | null {
  const normalized = ` ${normalizeText(raw)} `;
  if (!normalized.trim()) return null;
  let best: { entry: AssistToolEntry; length: number } | null = null;
  for (const entry of ASSIST_KNOWLEDGE_BASE) {
    const anchors = [entry.displayName, entry.id, entry.toolId, ...entry.aliases];
    for (const anchor of anchors) {
      const needle = normalizeText(anchor);
      if (!needle || needle.length < 3) continue;
      if (!normalized.includes(` ${needle} `)) continue;
      if (!best || needle.length > best.length) best = { entry, length: needle.length };
    }
  }
  return best?.entry ?? null;
}

function exactTopicMatch(raw: string): AssistTopicEntry | null {
  const normalized = ` ${normalizeText(raw)} `;
  if (!normalized.trim()) return null;
  let best: { topic: AssistTopicEntry; length: number } | null = null;
  for (const topic of ASSIST_TOPICS) {
    const anchors = [topic.displayName, topic.id, ...topic.aliases];
    for (const anchor of anchors) {
      const needle = normalizeText(anchor);
      if (!needle || needle.length < 3) continue;
      if (!normalized.includes(` ${needle} `)) continue;
      if (!best || needle.length > best.length) best = { topic, length: needle.length };
    }
  }
  return best?.topic ?? null;
}

/* ------------------------------------------------------------------ */
/* Fuzzy matching (Damerau-Levenshtein)                                */
/* ------------------------------------------------------------------ */

function damerauLevenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
}

const STOPWORDS = new Set([
  "the","a","an","of","to","for","with","and","or","on","in","my","this","that","these","those",
  "is","are","was","were","be","do","does","did","how","what","why","which","can","i","you","it",
  "please","help","me","us","pdf","pdfs","doc","docs","document","documents","file","files","two",
]);

function tokenize(raw: string): string[] {
  return normalizeText(raw).split(" ").filter((t) => t && !STOPWORDS.has(t));
}

interface FuzzyHit {
  entry: AssistToolEntry;
  score: number;
  matchedToken: string;
  matchedAnchor: string;
}

function fuzzyToolMatch(raw: string): FuzzyHit[] {
  const tokens = tokenize(raw).filter((t) => t.length >= 4);
  if (tokens.length === 0) return [];
  const CONFIDENT = 0.88;
  const CANDIDATE = 0.78;
  const perEntry = new Map<string, FuzzyHit>();
  for (const entry of ASSIST_KNOWLEDGE_BASE) {
    const anchors = new Set<string>();
    for (const a of [entry.displayName, entry.id, ...entry.aliases]) {
      for (const tok of normalizeText(a).split(" ")) {
        if (tok.length >= 4) anchors.add(tok);
      }
    }
    let best: FuzzyHit | null = null;
    for (const t of tokens) {
      for (const anchor of anchors) {
        if (Math.abs(anchor.length - t.length) > 3) continue;
        const dist = damerauLevenshtein(t, anchor);
        const score = 1 - dist / Math.max(t.length, anchor.length);
        if (score < CANDIDATE) continue;
        if (!best || score > best.score) {
          best = { entry, score, matchedToken: t, matchedAnchor: anchor };
        }
      }
    }
    if (best) {
      const prev = perEntry.get(entry.id);
      if (!prev || best.score > prev.score) perEntry.set(entry.id, best);
    }
  }
  const all = Array.from(perEntry.values()).sort((a, b) => b.score - a.score);
  // Drop hits below candidate threshold; caller decides confident vs suggestion.
  return all.filter((h) => h.score >= CANDIDATE).slice(0, 3).map((h) => ({
    ...h,
    // If token IS the exact anchor, it would have been caught by exactToolMatch.
    // Keep as-is; caller checks CONFIDENT threshold.
  }));
  void CONFIDENT;
}

/* ------------------------------------------------------------------ */
/* Follow-up detection                                                 */
/* ------------------------------------------------------------------ */

const FOLLOWUP_CUES = /^\s*(adjust|change|more|also|and|what\s+about|how\s+about|why|how|can\s+i|does\s+it|is\s+it|is\s+that|then|tell\s+me\s+more|explain|another)\b/i;
const PRONOUN_ONLY = /^\s*(it|that|this|them|those|these)[\s?!.]*$/i;
const TOOL_NOUN_RE = /\b(redact|bates|sanitize|ocr|watermark|split|merge|organize|extract|rotate|crop|compress|convert|sign|protect|unlock|repair|comments?|highlight|outline|bookmark|compare|toa|citation|privilege|exhibit|binder|workflow|chat|mail\s*merge|hash|checksum|header|footer|flatten|batch|image)\b/i;

function isFollowUp(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const tokens = tokenize(trimmed);
  if (PRONOUN_ONLY.test(trimmed)) return true;
  const hasCue = FOLLOWUP_CUES.test(trimmed);
  const hasTool = TOOL_NOUN_RE.test(trimmed);
  if (hasCue && !hasTool) return true;
  if (tokens.length <= 3 && !hasTool) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Literal vs semantic detection                                       */
/* ------------------------------------------------------------------ */

/** Extract a quoted term. Handles both straight and smart quotes. */
function extractQuoted(raw: string): string | null {
  const m = raw.match(/["“'‘]([^"”'’]{1,120})["”'’]/);
  return m ? m[1].trim() : null;
}

/** "the word X" / "the phrase X" / "exact match X" / "word 'X'" cues. */
function extractLiteralCue(raw: string): string | null {
  const m = raw.match(/\b(?:the\s+)?(?:word|phrase|term|string|text|exact(?:\s+match)?)\s+["“'‘]?([\w'\-.]{2,60})["”'’]?/i);
  return m ? m[1].trim() : null;
}

/** /regex/flags syntax. */
function extractRegex(raw: string): string | null {
  const m = raw.match(/\bregex\s+\/([^/]+)\//i) || raw.match(/^\/([^/]+)\/[gimsuy]*$/);
  return m ? m[1] : null;
}

/**
 * Content-descriptor phrases that suggest semantic search rather than
 * literal find. "find sensitive contracts", "passages about damages",
 * "clauses that mention X", "everything related to Y".
 */
const SEMANTIC_CUE_RE = /\b(passages?|clauses?|sections?|paragraphs?|mentions?|references?|discussions?|topics?)\s+(?:about|on|regarding|related\s+to|that|which)\b/i;
const ABOUT_RE = /\b(?:about|regarding|related\s+to|concerning|dealing\s+with)\b/i;
const FIND_VERB_RE = /^\s*(?:find|show|list|search(?:\s+for)?|look\s+for|locate|get\s+me)\b/i;
/** Adjective before noun in "find <adj> <noun>" is a strong semantic signal. */
const SEMANTIC_DESCRIPTOR_RE = /\b(?:sensitive|confidential|privileged|important|relevant|risky|financial|personal|private|key|critical|material)\s+\w+/i;

/* ------------------------------------------------------------------ */
/* Directed clarify — PII nouns + unhandled verbs                      */
/* ------------------------------------------------------------------ */

/**
 * PII / patterned-value nouns the user often references without saying
 * which lane they want. Each entry maps a matcher to a display label
 * and a literal-search term. The router turns these into a directed
 * "find / count / redact?" clarify prompt instead of a wrong guess or
 * an accidental semantic-search index build.
 */
const PII_NOUNS: Array<{ re: RegExp; label: string; term: string }> = [
  { re: /\b(ssn|social\s+security(?:\s+number)?s?)\b/i, label: "SSNs", term: "ssn" },
  { re: /\bphone(?:\s+numbers?)?\b/i, label: "phone numbers", term: "phone" },
  { re: /\bemail(?:\s+address(?:es)?)?\b/i, label: "email addresses", term: "email" },
  { re: /\b(dob|dates?\s+of\s+birth|birthdays?)\b/i, label: "dates of birth", term: "dob" },
  { re: /\b(credit\s+card|card\s+numbers?|cc\s+numbers?)\b/i, label: "credit card numbers", term: "credit card" },
  { re: /\b(account\s+numbers?|bank\s+accounts?)\b/i, label: "account numbers", term: "account" },
  { re: /\b(addresses?|street\s+addresses?|mailing\s+addresses?)\b/i, label: "addresses", term: "address" },
];

const COUNT_VERB_RE = /^\s*(?:count|how\s+many|number\s+of|tally)\b/i;
/** Verbs the router doesn't have a direct lane for but that clearly need one. */
const UNHANDLED_VERBS: Array<{ re: RegExp; label: string }> = [
  { re: /^\s*(?:analy[sz]e|examine|review)\b/i, label: "analyze" },
  { re: /^\s*summari[sz]e\b/i, label: "summarize" },
  { re: /^\s*(?:extract|pull)\b/i, label: "extract" },
];

function detectPiiNoun(raw: string): { label: string; term: string } | null {
  for (const p of PII_NOUNS) if (p.re.test(raw)) return { label: p.label, term: p.term };
  return null;
}



export async function classifyAssistQuery(
  input: string,
  ctx?: AssistCtx,
): Promise<AssistClassification> {
  const raw = input.trim();

  // Cross-lane follow-up: after a literal find, "redact them" / "now redact those"
  // should reuse the last found term as a Redact staging trigger.
  if (
    ctx?.lastLane === "literal" &&
    ctx.lastFindTerm &&
    /\bredact\b/i.test(raw) &&
    /\b(them|those|these|it|all|matches|results)\b/i.test(raw)
  ) {
    const redactEntry = ASSIST_KNOWLEDGE_BASE.find((e) => e.id === "redact");
    if (redactEntry) {
      return {
        kind: "tool",
        entry: redactEntry,
        mode: "use",
        score: 1,
        followUp: true,
        contextFrom: "literal",
        stagedTerm: ctx.lastFindTerm,
      };
    }
  }

  const queryKey = normalizeQueryKey(raw);

  // 0b. Learned short-circuit: user has picked the same tool ≥ 2 times for
  //     this query — skip clarify entirely and route straight there.
  const learnedToolId = preferredToolFor(queryKey);
  if (learnedToolId) {
    const learned = ASSIST_KNOWLEDGE_BASE.find(
      (e) => e.id === learnedToolId || e.toolId === learnedToolId,
    );
    if (learned) {
      console.info("[ai-assist] learned route", { query: raw, id: learned.id });
      return { kind: "tool", entry: learned, mode: inferMode(raw), score: 1 };
    }
  }

  // 0c. PII noun without an explicit lane verb → directed clarify.
  //     "count the SSNs", "phone numbers", "redact ssn" all land here
  //     UNLESS a specific tool verb pins the lane. We deliberately do
  //     NOT route these into Pre-Discovery (semantic index build) —
  //     that's the accidental-indexing bug the plan calls out.
  const pii = detectPiiNoun(raw);
  const hasExplicitRedact = /\bredact(?:s|ing|ion)?\b/i.test(raw);
  const looksLikeCount = COUNT_VERB_RE.test(raw);
  if (pii && !hasExplicitRedact) {
    const nounKey = pii.term.toLowerCase();
    const learnedLane = preferredLaneFor(nounKey);
    if (learnedLane === "action") {
      const redact = ASSIST_KNOWLEDGE_BASE.find((e) => e.id === "redact");
      if (redact) return { kind: "tool", entry: redact, mode: "use", score: 1, stagedTerm: pii.term };
    }
    if (learnedLane === "literal") {
      return {
        kind: "literal",
        term: pii.term,
        wholeWord: false,
        regex: false,
        reason: `Searching for ${pii.label} in this document.`,
      };
    }
    // No learned pref → ask the user, prefilled with count if they said "count".
    return {
      kind: "clarify-ask",
      reason: `"${raw}" — do you want to find, count, or redact ${pii.label}?`,
      question: `Do you want to find, count, or redact the ${pii.label} in this document?`,
      queryKey,
      nounKey,
      choices: [
        {
          id: "count",
          label: `Count ${pii.label}`,
          lane: "literal",
          term: pii.term,
          countOnly: true,
        },
        {
          id: "find",
          label: `Find matches`,
          lane: "literal",
          term: pii.term,
        },
        {
          id: "redact",
          label: `Redact all`,
          lane: "action",
          actionToolId: "redact",
          term: pii.term,
        },
      ],
    };
  }
  // Deliberately not used in the clarify prompt but reserved for future
  // "You said count — here's the count" shortcuts.
  void looksLikeCount;

  // 1. Exact tool match
  const exact = exactToolMatch(raw);
  if (exact) {
    console.info("[ai-assist] lexical route", { query: raw, id: exact.id });
    return { kind: "tool", entry: exact, mode: inferMode(raw), score: 1 };
  }

  // 2. Exact topic match
  const topicExact = exactTopicMatch(raw);
  if (topicExact) {
    console.info("[ai-assist] topic lexical route", { query: raw, id: topicExact.id });
    return { kind: "topic", topic: topicExact, score: 1 };
  }

  // 2b. Unhandled verbs ("analyze this contract", "summarize it") → ask.
  for (const v of UNHANDLED_VERBS) {
    if (v.re.test(raw)) {
      return {
        kind: "clarify-ask",
        reason: `I can do a few things with "${raw}". Which one?`,
        question: `What should I do with this document?`,
        queryKey,
        choices: [
          { id: "chat", label: "Ask AI Chat", lane: "help", toolId: "chat" },
          { id: "search", label: "Search by meaning", lane: "semantic" },
          { id: "find", label: "Find literal text", lane: "literal", term: raw.replace(v.re, "").trim() },
        ],
      };
    }
  }

  // 3. Literal-find lane (rules 1 & 2 from the plan)
  const quoted = extractQuoted(raw);
  if (quoted) {
    return {
      kind: "literal",
      term: quoted,
      wholeWord: false,
      regex: false,
      reason: `Searching for the exact text “${quoted}” in this document.`,
    };
  }
  const regexTerm = extractRegex(raw);
  if (regexTerm) {
    return {
      kind: "literal",
      term: regexTerm,
      wholeWord: false,
      regex: true,
      reason: `Searching this document with the regular expression /${regexTerm}/.`,
    };
  }
  const cued = extractLiteralCue(raw);
  if (cued) {
    return {
      kind: "literal",
      term: cued,
      wholeWord: true,
      regex: false,
      reason: `Searching for the exact word “${cued}” in this document.`,
      alternates: [{ lane: "semantic", label: `Search by meaning instead` }],
    };
  }

  // 4. Semantic-descriptor lane (rule 6): find + adjective/about/passages phrasing
  //    with no action verb → semantic search proposal.
  const looksLikeFind = FIND_VERB_RE.test(raw);
  const hasSemanticShape = SEMANTIC_CUE_RE.test(raw) || SEMANTIC_DESCRIPTOR_RE.test(raw) || ABOUT_RE.test(raw);
  const hasActionVerb = USE_RE.test(raw) && !/^\s*(?:find|show|list|search|look\s+for|locate)\b/i.test(raw);
  if (looksLikeFind && hasSemanticShape && !hasActionVerb) {
    return {
      kind: "semantic",
      query: raw.replace(FIND_VERB_RE, "").trim() || raw,
      reason: "Interpreting this as a meaning-based search across the document.",
      alternates: [{ lane: "literal", label: "Find exact matches instead" }],
    };
  }

  // 4b. Bare noun / short find-phrase → ambiguous. Offer both lanes plus Redact.
  //     Only kicks in when the user said "find/show X" with no other cues.
  if (looksLikeFind && !hasSemanticShape && !hasActionVerb) {
    const term = raw.replace(FIND_VERB_RE, "").replace(/[?.!]+$/, "").trim();
    if (term && tokenize(term).length <= 3) {
      return {
        kind: "literal",
        term,
        wholeWord: true,
        regex: false,
        reason: `Searching for the exact word “${term}” in this document. Not what you meant?`,
        alternates: [
          { lane: "semantic", label: `Search by meaning` },
          { lane: "action", label: `Redact "${term}"` },
        ],
      };
    }
  }

  // 5. Follow-up: sticky-bias to previous subject if the query is clearly a follow-up
  const followUp = isFollowUp(raw) && (ctx?.lastEntryId || ctx?.lastTopicId);
  const virtualQuery = followUp && ctx?.lastQuery ? `${ctx.lastQuery} ${raw}` : raw;





  // 4. Fuzzy match — runs BEFORE embeddings, on the *original* raw text
  // 4. Fuzzy match — runs BEFORE embeddings, on the *original* raw text.
  //    Skip when this is a follow-up so common words in short replies
  //    ("more info", "adjust") don't hijack the sticky subject.
  const fuzzy = followUp ? [] : fuzzyToolMatch(raw);
  const CONFIDENT = 0.88;
  if (fuzzy.length > 0) {
    const top = fuzzy[0];
    const runner = fuzzy[1];
    if (top.score >= CONFIDENT && (!runner || top.score - runner.score >= 0.08)) {
      console.info("[ai-assist] fuzzy confident", { from: top.matchedToken, to: top.matchedAnchor, id: top.entry.id });
      return {
        kind: "tool",
        entry: top.entry,
        mode: "help",
        score: top.score,
        corrected: { from: top.matchedToken, to: top.matchedAnchor },
      };
    }
    // Multiple candidates → let user pick
    console.info("[ai-assist] fuzzy clarify", { suggestions: fuzzy.map((h) => h.entry.id) });
    return {
      kind: "clarify-typo",
      original: raw,
      suggestions: fuzzy.map((h) => h.entry),
    };
  }

  // 5. Semantic
  const [queryVec] = await embedTexts([virtualQuery], "ai-assist:submit-query");
  const { dim, matrix, owners } = await buildAnchors();

  const perTool = new Array<number>(ASSIST_KNOWLEDGE_BASE.length).fill(-Infinity);
  const perTopic = new Array<number>(ASSIST_TOPICS.length).fill(-Infinity);
  for (let i = 0; i < owners.length; i++) {
    const s = dot(queryVec, matrix, i * dim, dim);
    const o = owners[i];
    if (o.kind === "tool") {
      if (s > perTool[o.idx]) perTool[o.idx] = s;
    } else {
      if (s > perTopic[o.idx]) perTopic[o.idx] = s;
    }
  }

  const ranked: Array<{ owner: AnchorIndex["owners"][0]; score: number }> = [];
  perTool.forEach((score, idx) => ranked.push({ owner: { kind: "tool", idx }, score }));
  perTopic.forEach((score, idx) => ranked.push({ owner: { kind: "topic", idx }, score }));

  // Context boost — sticky bias to the anchored subject
  if (followUp) {
    for (const r of ranked) {
      if (r.owner.kind === "tool" && ctx?.lastEntryId) {
        const entry = ASSIST_KNOWLEDGE_BASE[r.owner.idx];
        if (entry?.id === ctx.lastEntryId) r.score += CONTEXT_BOOST;
      }
      if (r.owner.kind === "topic" && ctx?.lastTopicId) {
        const topic = ASSIST_TOPICS[r.owner.idx];
        if (topic?.id === ctx.lastTopicId) r.score += CONTEXT_BOOST;
      }
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const runner = ranked[1];

  console.info("[ai-assist] semantic route", {
    query: raw,
    followUp: !!followUp,
    top5: ranked.slice(0, 5).map((r) => ({
      kind: r.owner.kind,
      id: r.owner.kind === "tool"
        ? ASSIST_KNOWLEDGE_BASE[r.owner.idx]?.id
        : ASSIST_TOPICS[r.owner.idx]?.id,
      score: Number(r.score.toFixed(3)),
    })),
  });

  const minScore = followUp ? MIN_SCORE - CONTEXT_BOOST : MIN_SCORE;

  // Follow-up escape hatch: if we have context and top is below threshold, stick to previous subject
  if (followUp && (!top || top.score < minScore)) {
    if (ctx?.lastEntryId) {
      const entry = ASSIST_KNOWLEDGE_BASE.find((e) => e.id === ctx.lastEntryId);
      if (entry) {
        return { kind: "tool", entry, mode: "help", score: top?.score ?? 0, followUp: true, contextFrom: ctx.lastEntryId };
      }
    }
    if (ctx?.lastTopicId) {
      const topic = ASSIST_TOPICS.find((t) => t.id === ctx.lastTopicId);
      if (topic) {
        return { kind: "topic", topic, score: top?.score ?? 0, followUp: true, contextFrom: ctx.lastTopicId };
      }
    }
  }

  if (!top || top.score < minScore) {
    return {
      kind: "clarify",
      reason: "I can help with tools or search the document. Which direction did you mean?",
      options: fallbackOptions(ranked),
      score: top?.score ?? 0,
    };
  }

  // Build result from top owner
  if (top.owner.kind === "topic") {
    const topic = ASSIST_TOPICS[top.owner.idx];
    return {
      kind: "topic",
      topic,
      score: top.score,
      followUp: !!followUp,
      contextFrom: followUp ? ctx?.lastTopicId ?? ctx?.lastEntryId : undefined,
    };
  }

  const topEntry = ASSIST_KNOWLEDGE_BASE[top.owner.idx];
  const runnerEntry =
    runner && runner.owner.kind === "tool" ? ASSIST_KNOWLEDGE_BASE[runner.owner.idx] : undefined;

  // Clarify only when NOT a follow-up (follow-ups snap to context)
  if (
    !followUp &&
    runnerEntry &&
    topEntry.toolId !== runnerEntry.toolId &&
    top.score - runner.score < CLARIFY_GAP
  ) {
    return {
      kind: "clarify",
      reason: `Did you mean ${topEntry.displayName} or ${runnerEntry.displayName}?`,
      options: [topEntry, runnerEntry],
      score: top.score,
    };
  }

  return {
    kind: "tool",
    entry: topEntry,
    mode: inferMode(raw),
    score: top.score,
    runnerUp: runnerEntry ? { entry: runnerEntry, score: runner.score } : undefined,
    followUp: !!followUp,
    contextFrom: followUp ? ctx?.lastEntryId : undefined,
  };
}
