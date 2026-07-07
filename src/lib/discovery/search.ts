/**
 * Two-stage Pre-Discovery search.
 *
 *   Stage 1 — keyword pre-filter (BM25, milliseconds):
 *     Extract paragraph chunks from the PDF once per docKey, build a
 *     tiny in-memory BM25 index, and shortlist the top ~80 candidate
 *     passages for the query. No embeddings involved.
 *
 *   Stage 2 — semantic ranking (MiniLM, only on the shortlist):
 *     Load any previously cached vectors for the shortlisted chunk
 *     ids from IndexedDB, embed the missing ones, embed the query,
 *     cosine-rank. Newly computed vectors are persisted per chunk so
 *     the next search on the same document is instant.
 *
 * This avoids embedding an entire 5 000-page document up-front. The
 * panel calls this and reports "Searching…" → "Ranking most relevant
 * passages…" while the two stages run.
 */

import type { PdfChunk } from "@/lib/chat/pdf-extract";
import { buildIndex, search as bm25Search, type Bm25Index } from "@/lib/chat/bm25";
import { addDiscoveryDebug, embedTexts, loadModel } from "./client";
import { loadChunkVectors, saveChunkVectors } from "./index-cache";

export interface DiscoveryChunk extends PdfChunk {
  id: string;
}

export interface SemanticHit {
  id: string;
  page: number;
  text: string;
  score: number;
}

export type SearchStage = "extract" | "keyword" | "semantic";

export interface SearchOptions {
  topK?: number;
  shortlistSize?: number;
  onStage?: (stage: SearchStage, info?: { candidates?: number }) => void;
  onExtractProgress?: (page: number, totalPages: number) => void;
  signal?: AbortSignal;
}

interface DocEntry {
  chunks: DiscoveryChunk[];
  bm25: Bm25Index;
}

const docEntries = new Map<string, DocEntry>();
const extractInflight = new Map<string, Promise<DocEntry>>();

/** True once chunks + BM25 have been prepared for docKey. */
export function isDocReady(docKey: string): boolean {
  return docEntries.has(docKey);
}

/** Free memory when a document tab is closed. */
export function dropDoc(docKey: string): void {
  docEntries.delete(docKey);
  extractInflight.delete(docKey);
}

async function ensureDocEntry(
  file: File,
  docKey: string,
  opts: SearchOptions,
): Promise<DocEntry> {
  const cached = docEntries.get(docKey);
  if (cached) return cached;
  const inflight = extractInflight.get(docKey);
  if (inflight) return inflight;

  const promise = (async () => {
    opts.onStage?.("extract");
    const { extractPdfParagraphChunks } = await import("@/lib/chat/pdf-extract");
    const raw = await extractPdfParagraphChunks(
      file,
      300,
      120,
      opts.onExtractProgress,
      { signal: opts.signal },
    );
    // Paragraph chunks come 1-based; the editor uses 0-based pages.
    const chunks: DiscoveryChunk[] = raw.map((c, i) => ({
      ...c,
      page: c.page - 1,
      id: `${c.page - 1}:${i}`,
    }));
    const entry: DocEntry = { chunks, bm25: buildIndex(chunks) };
    docEntries.set(docKey, entry);
    addDiscoveryDebug("doc prepared", { chunks: chunks.length });
    return entry;
  })().finally(() => {
    extractInflight.delete(docKey);
  });

  extractInflight.set(docKey, promise);
  return promise;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export async function searchDocument(
  file: File,
  docKey: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SemanticHit[]> {
  const q = query.trim();
  if (!q) return [];
  const topK = opts.topK ?? 20;
  const shortlistSize = opts.shortlistSize ?? 80;

  // Kick model download in parallel with chunk extraction — the two
  // don't depend on each other.
  const modelPromise = loadModel(undefined, "pre-discovery:search").catch((err) => {
    throw err;
  });

  const entry = await ensureDocEntry(file, docKey, opts);
  if (entry.chunks.length === 0) return [];

  // Stage 1: BM25 shortlist — cheap and fast, no embeddings.
  opts.onStage?.("keyword");
  const bmHits = bm25Search(entry.bm25, q, shortlistSize);

  let candidateIds: string[];
  let candidates: DiscoveryChunk[];
  if (bmHits.length === 0) {
    // Nothing matched keywords — fall back to a bounded semantic sweep
    // so we still surface something for paraphrase-only queries.
    candidates = entry.chunks.slice(0, shortlistSize);
    candidateIds = candidates.map((c) => c.id);
  } else {
    candidates = bmHits.map((h) => entry.chunks[h.index]);
    candidateIds = candidates.map((c) => c.id);
  }

  addDiscoveryDebug("keyword shortlist", {
    query: q,
    bm25: bmHits.length,
    candidates: candidates.length,
    totalChunks: entry.chunks.length,
  });

  // Stage 2: semantic ranking on the shortlist only.
  opts.onStage?.("semantic", { candidates: candidates.length });
  await modelPromise;

  const cached = await loadChunkVectors(docKey, candidateIds);
  const missing = candidates.filter((c) => !cached.has(c.id));

  let freshDim = 0;
  const fresh: Array<{ id: string; vec: Float32Array }> = [];
  if (missing.length > 0) {
    const vecs = await embedTexts(missing.map((c) => c.text), "pre-discovery:candidates");
    for (let i = 0; i < missing.length; i++) {
      const v = vecs[i];
      cached.set(missing[i].id, v);
      fresh.push({ id: missing[i].id, vec: v });
      if (!freshDim) freshDim = v.length;
    }
    // Persist newly-embedded vectors in the background; do not block the
    // search on the write.
    if (freshDim > 0) {
      void saveChunkVectors(docKey, freshDim, fresh).catch(() => {});
    }
  }

  const [qv] = await embedTexts([q], "pre-discovery:query");

  const scored = candidates.map((c) => {
    const v = cached.get(c.id);
    return {
      id: c.id,
      page: c.page,
      text: c.text,
      score: v ? cosine(qv, v) : 0,
    };
  });
  scored.sort((a, b) => b.score - a.score);

  addDiscoveryDebug("semantic ranked", {
    query: q,
    candidates: candidates.length,
    reused: candidates.length - missing.length,
    embedded: missing.length,
    top5: scored.slice(0, 5).map((s) => ({
      page1: s.page + 1,
      score: +s.score.toFixed(3),
      textHead: s.text.slice(0, 90),
    })),
  });

  return scored.slice(0, topK);
}
