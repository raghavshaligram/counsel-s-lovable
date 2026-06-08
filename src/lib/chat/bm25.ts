// Tiny pure-JS BM25 index. ~80 lines, zero deps.
// Good enough as first-pass retrieval over a single PDF.

import type { PdfChunk } from "./pdf-extract";

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","for","from","has","have","he",
  "in","is","it","its","of","on","or","that","the","this","to","was","were",
  "will","with","you","your","i","we","they","them","there","their","what",
  "which","who","whom","whose","how","when","where","why","do","does","did",
  "not","no","yes","so","if","then","than","such","also","very","can","could",
  "would","should","may","might","must","into","about","over","under","up",
  "down","out","off","just","more","most","other","some","any","all","each",
  "one","two","three"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface Bm25Index {
  chunks: PdfChunk[];
  docTokens: string[][];
  docFreq: Map<string, number>;
  avgLen: number;
  N: number;
}

export function buildIndex(chunks: PdfChunk[]): Bm25Index {
  const docTokens = chunks.map((c) => tokenize(c.text));
  const docFreq = new Map<string, number>();
  for (const tokens of docTokens) {
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }
  const totalLen = docTokens.reduce((s, t) => s + t.length, 0);
  return {
    chunks,
    docTokens,
    docFreq,
    avgLen: docTokens.length ? totalLen / docTokens.length : 0,
    N: docTokens.length,
  };
}

export interface SearchHit {
  chunk: PdfChunk;
  score: number;
  index: number;
}

const K1 = 1.5;
const B = 0.75;

export function search(
  index: Bm25Index,
  query: string,
  topK = 4,
): SearchHit[] {
  const qTokens = Array.from(new Set(tokenize(query)));
  if (qTokens.length === 0 || index.N === 0) return [];

  const scores = new Float32Array(index.N);
  for (const qt of qTokens) {
    const df = index.docFreq.get(qt);
    if (!df) continue;
    const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < index.N; i++) {
      const tokens = index.docTokens[i];
      if (tokens.length === 0) continue;
      let tf = 0;
      for (const t of tokens) if (t === qt) tf++;
      if (tf === 0) continue;
      const denom = tf + K1 * (1 - B + (B * tokens.length) / (index.avgLen || 1));
      scores[i] += idf * ((tf * (K1 + 1)) / denom);
    }
  }

  const ranked: SearchHit[] = [];
  for (let i = 0; i < index.N; i++) {
    if (scores[i] > 0) ranked.push({ chunk: index.chunks[i], score: scores[i], index: i });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, topK);
}
