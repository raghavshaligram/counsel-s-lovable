/**
 * Document Q&A — grounded answers over the currently-open PDF.
 *
 * Reuses the Pre-Discovery MiniLM index (same worker, same paragraph
 * chunks, same cosine ranking). On first use for a document it lazily
 * extracts + indexes; subsequent calls reuse the cached index. Nothing
 * uploads — all embedding and retrieval runs in the worker.
 *
 * Returns a compact grounded reply: a short synthesised answer stitched
 * from the top passages plus deduped source page chips (1-based, ready
 * for the Counsel panel). If nothing crosses the relevance floor we
 * return `null` so the caller can honestly say so and offer Pre-Discovery.
 */

import {
  hasIndex,
  indexDocument,
  queryIndex,
  loadModel,
  type Hit,
} from "@/lib/discovery/client";

export type GroundedReply = {
  answer: string;
  sources: Array<{ page: number; quote?: string }>;
  hitCount: number;
};

export function docKeyFor(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

const indexingByKey = new Map<string, Promise<boolean>>();

async function ensureIndex(file: File): Promise<boolean> {
  const key = docKeyFor(file);
  if (hasIndex(key)) return true;
  const existing = indexingByKey.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      await loadModel();
      const { extractPdfParagraphChunks } = await import("@/lib/chat/pdf-extract");
      const raw = await extractPdfParagraphChunks(file, 300, 120);
      if (raw.length === 0) return false;
      // Normalise page indices to 0-based to match the Pre-Discovery panel,
      // so the same worker cache is compatible with either code path.
      const chunks = raw.map((c, i) => ({
        ...c,
        page: c.page - 1,
        id: `${c.page - 1}:${i}`,
      }));
      await indexDocument(key, chunks);
      return true;
    } catch (err) {
      console.warn("[doc-qa] index failed", err);
      return false;
    } finally {
      indexingByKey.delete(key);
    }
  })();
  indexingByKey.set(key, p);
  return p;
}

/** Trim a passage for use as a source-chip tooltip or synthesised snippet. */
function trimSnippet(text: string, max = 240): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s\S*$/, "") + "…";
}

/**
 * Ask a question of the current document. Resolves to a grounded reply
 * or `null` when nothing relevant is retrieved.
 */
export async function answerFromDocument(
  file: File,
  question: string,
): Promise<GroundedReply | null> {
  const q = question.trim();
  if (!q) return null;
  const ok = await ensureIndex(file);
  if (!ok) return null;

  const key = docKeyFor(file);
  const hits: Hit[] = await queryIndex(key, q, 8);
  if (hits.length === 0) return null;

  // Same rank/floor rules as Pre-Discovery: absolute noise floor + a
  // relative floor tied to the top hit. Anything that clears both counts
  // as a real citation.
  const MIN_ABS = 0.15;
  const REL_GAP = 0.6;
  const top = hits[0].score;
  if (top < MIN_ABS) return null;
  const floor = Math.max(MIN_ABS, top * REL_GAP);
  const kept = hits.filter((h) => h.score >= floor).slice(0, 4);
  if (kept.length === 0) return null;

  // Dedupe pages for the chips (a single page can contribute several
  // chunks); keep the highest-scoring passage's snippet per page.
  const byPage = new Map<number, Hit>();
  for (const h of kept) {
    const existing = byPage.get(h.page);
    if (!existing || h.score > existing.score) byPage.set(h.page, h);
  }
  const sources = Array.from(byPage.values())
    .sort((a, b) => a.page - b.page)
    .map((h) => ({ page: h.page + 1, quote: trimSnippet(h.text, 160) }));

  // Simple extractive synthesis: lead with the strongest passage and
  // mention where corroborating context comes from. Keeps answers
  // faithful — no free-form paraphrasing that could invent facts.
  const lead = trimSnippet(kept[0].text, 320);
  const pages = sources.map((s) => `p.${s.page}`).join(", ");
  const answer =
    kept.length === 1
      ? `From ${pages}:\n\n"${lead}"`
      : `Based on ${sources.length} passage${sources.length === 1 ? "" : "s"} (${pages}):\n\n"${lead}"`;

  return { answer, sources, hitCount: kept.length };
}
