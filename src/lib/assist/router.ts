import { embedTexts } from "@/lib/discovery/client";
import {
  ASSIST_KNOWLEDGE_BASE,
  ASSIST_TOPICS,
  type AssistToolEntry,
  type AssistTopicEntry,
} from "./knowledge-base";

export type AssistMode = "help" | "open" | "use";

export interface AssistCtx {
  lastEntryId?: string;
  lastTopicId?: string;
  lastQuery?: string;
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
    }
  | {
      kind: "topic";
      topic: AssistTopicEntry;
      score: number;
      followUp?: boolean;
      contextFrom?: string;
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
/* Classifier                                                          */
/* ------------------------------------------------------------------ */

export async function classifyAssistQuery(
  input: string,
  ctx?: AssistCtx,
): Promise<AssistClassification> {
  const raw = input.trim();

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

  // 3. Follow-up: sticky-bias to previous subject if the query is clearly a follow-up
  const followUp = isFollowUp(raw) && (ctx?.lastEntryId || ctx?.lastTopicId);
  const virtualQuery = followUp && ctx?.lastQuery ? `${ctx.lastQuery} ${raw}` : raw;

  // 4. Fuzzy match — runs BEFORE embeddings, on the *original* raw text
  const fuzzy = fuzzyToolMatch(raw);
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
