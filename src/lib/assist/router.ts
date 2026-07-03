import { embedTexts } from "@/lib/discovery/client";
import { ASSIST_KNOWLEDGE_BASE, type AssistToolEntry } from "./knowledge-base";

export type AssistMode = "help" | "open" | "use";

export type AssistClassification =
  | {
      kind: "tool";
      entry: AssistToolEntry;
      mode: AssistMode;
      score: number;
      runnerUp?: { entry: AssistToolEntry; score: number };
    }
  | {
      kind: "clarify";
      reason: string;
      options: AssistToolEntry[];
      score: number;
    };

type AnchorIndex = {
  dim: number;
  matrix: Float32Array;
  owners: number[];
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

function buildAnchors(): Promise<AnchorIndex> {
  if (anchorPromise) return anchorPromise;
  anchorPromise = (async () => {
    const texts: string[] = [];
    const owners: number[] = [];
    ASSIST_KNOWLEDGE_BASE.forEach((entry, idx) => {
      anchorTextsFor(entry).forEach((text) => {
        texts.push(text);
        owners.push(idx);
      });
    });
    const vecs = await embedTexts(texts, "ai-assist:build-training-doc-anchors");
    const dim = vecs[0]?.length ?? 0;
    const matrix = new Float32Array(dim * vecs.length);
    vecs.forEach((vec, idx) => matrix.set(vec, idx * dim));
    console.info("[ai-assist] training doc anchors ready", {
      tools: ASSIST_KNOWLEDGE_BASE.length,
      anchors: vecs.length,
      dim,
    });
    return { dim, matrix, owners };
  })();
  return anchorPromise;
}

function dot(q: Float32Array, matrix: Float32Array, offset: number, dim: number) {
  let score = 0;
  for (let i = 0; i < dim; i++) score += q[i] * matrix[offset + i];
  return score;
}

const HELP_RE = /\b(what|whats|what's|how|why|explain|describe|tell\s+me|help|does|do\s+i|can\s+i|when\s+(?:should|to)|which|difference|meaning|define|definition|purpose)\b/i;
const OPEN_RE = /^\s*(open|show|go\s+to|take\s+me\s+to|launch)\b/i;
const USE_RE = /\b(add|apply|run|scan|detect|find|search|ask|summari[sz]e|redact|black\s*out|stamp|split|merge|combine|sanitize|scrub|ocr|repair|protect|unlock|sign|fill|convert|hash|compute|generate|build|assemble|create|watermark|number)\b/i;

function inferMode(raw: string): AssistMode {
  // Help intent wins over verb-noun mentions: "what is redact" is a question,
  // not a command to run redact. Only classify as "use" when there is a clear
  // action verb AND no explanatory framing.
  if (HELP_RE.test(raw)) return "help";
  if (OPEN_RE.test(raw)) return "open";
  if (USE_RE.test(raw)) return "use";
  return "help";
}

function fallbackOptions(ranked: Array<{ idx: number; score: number }>): AssistToolEntry[] {
  const out: AssistToolEntry[] = [];
  for (const item of ranked) {
    const entry = ASSIST_KNOWLEDGE_BASE[item.idx];
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

export async function classifyAssistQuery(input: string): Promise<AssistClassification> {
  const raw = input.trim();
  const exact = exactToolMatch(raw);
  if (exact) {
    console.info("[ai-assist] lexical route", { query: raw, id: exact.id });
    return {
      kind: "tool",
      entry: exact,
      mode: inferMode(raw),
      score: 1,
    };
  }

  const [queryVec] = await embedTexts([raw], "ai-assist:submit-query");
  const { dim, matrix, owners } = await buildAnchors();

  const perTool = new Array<number>(ASSIST_KNOWLEDGE_BASE.length).fill(-Infinity);
  for (let i = 0; i < owners.length; i++) {
    const score = dot(queryVec, matrix, i * dim, dim);
    const owner = owners[i];
    if (score > perTool[owner]) perTool[owner] = score;
  }

  const ranked = perTool
    .map((score, idx) => ({ idx, score }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const runner = ranked[1];

  console.info("[ai-assist] semantic route", {
    query: raw,
    top5: ranked.slice(0, 5).map((r) => ({
      id: ASSIST_KNOWLEDGE_BASE[r.idx]?.id,
      score: Number(r.score.toFixed(3)),
    })),
  });

  if (!top || top.score < MIN_SCORE) {
    return {
      kind: "clarify",
      reason: "I can help with tools or search the document. Which direction did you mean?",
      options: fallbackOptions(ranked),
      score: top?.score ?? 0,
    };
  }

  const topEntry = ASSIST_KNOWLEDGE_BASE[top.idx];
  const runnerEntry = runner ? ASSIST_KNOWLEDGE_BASE[runner.idx] : undefined;

  if (runnerEntry && topEntry.toolId !== runnerEntry.toolId && top.score - runner.score < CLARIFY_GAP) {
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
  };
}
