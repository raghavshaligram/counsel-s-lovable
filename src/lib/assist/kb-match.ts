/**
 * Counsel KB matcher — cosine similarity against on-device MiniLM
 * embeddings of every `questions` phrasing in the knowledge base.
 *
 * The MiniLM model is already loaded for Pre-Discovery + the command-bar
 * intent router; we reuse the same singleton worker via `embedTexts`
 * (no extra download). Anchors are built lazily on first use and cached
 * for the session.
 *
 * Follow-up context: an optional `recentTopic` biases the score toward
 * entries whose `topic` tags overlap with what the last turn discussed,
 * so "and the exemption codes?" after a Redact turn still lands in
 * Redact.
 */

import { embedTexts } from "@/lib/discovery/client";
import { KB, type KBEntry } from "./knowledge-base";

export interface KBMatch {
  entry: KBEntry;
  score: number;
  /** Second-best score, for confidence gap analysis. */
  runnerScore: number;
  runnerEntry: KBEntry | null;
}

/** High-confidence direct answer. */
export const KB_HIGH = 0.55;
/** Below this floor, don't even offer as a clarify option. */
export const KB_FLOOR = 0.4;
/** Follow-up bias when a topic tag matches the recent conversation topic. */
const TOPIC_BIAS = 0.04;

interface Anchors {
  dim: number;
  matrix: Float32Array; // flat: nExamples * dim
  ownerIdx: number[]; // per example → KB entry index
}

let anchorsPromise: Promise<Anchors> | null = null;

function buildAnchors(): Promise<Anchors> {
  if (anchorsPromise) return anchorsPromise;
  const texts: string[] = [];
  const ownerIdx: number[] = [];
  KB.forEach((entry, idx) => {
    entry.questions.forEach((q) => {
      texts.push(q);
      ownerIdx.push(idx);
    });
  });
  anchorsPromise = (async () => {
    const vecs = await embedTexts(texts);
    const dim = vecs[0]?.length ?? 0;
    const matrix = new Float32Array(dim * vecs.length);
    for (let i = 0; i < vecs.length; i++) matrix.set(vecs[i], i * dim);
    console.log(
      "[kb] anchors built —",
      vecs.length,
      "phrasings across",
      KB.length,
      "entries, dim=",
      dim,
    );
    return { dim, matrix, ownerIdx };
  })();
  return anchorsPromise;
}

function dot(q: Float32Array, m: Float32Array, off: number, dim: number) {
  let s = 0;
  for (let i = 0; i < dim; i++) s += q[i] * m[off + i];
  return s;
}

/**
 * Score every KB entry for the given query; return the two best.
 * `recentTopic` is the topic of the last assistant turn, if any — a small
 * bias is applied to entries that share a topic tag with it.
 */
export async function matchKB(
  query: string,
  opts: { recentTopic?: string[] } = {},
): Promise<KBMatch | null> {
  const q = query.trim();
  if (!q) return null;
  const [qVec] = await embedTexts([q]);
  const { dim, matrix, ownerIdx } = await buildAnchors();

  const perEntry = new Array<number>(KB.length).fill(-Infinity);
  for (let i = 0; i < ownerIdx.length; i++) {
    const s = dot(qVec, matrix, i * dim, dim);
    const idx = ownerIdx[i];
    if (s > perEntry[idx]) perEntry[idx] = s;
  }

  // Apply follow-up topic bias.
  if (opts.recentTopic && opts.recentTopic.length > 0) {
    const recent = new Set(opts.recentTopic);
    KB.forEach((entry, idx) => {
      if (entry.topic?.some((t) => recent.has(t))) {
        perEntry[idx] += TOPIC_BIAS;
      }
    });
  }

  const ranked = perEntry
    .map((s, idx) => ({ idx, s }))
    .sort((a, b) => b.s - a.s);
  const top = ranked[0];
  const runner = ranked[1];
  if (!top) return null;

  console.log(
    "[kb] query=",
    JSON.stringify(q),
    "top3=",
    ranked.slice(0, 3).map((r) => ({ id: KB[r.idx].id, s: +r.s.toFixed(3) })),
  );

  return {
    entry: KB[top.idx],
    score: top.s,
    runnerScore: runner?.s ?? -Infinity,
    runnerEntry: runner ? KB[runner.idx] : null,
  };
}
