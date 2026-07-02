/// <reference lib="webworker" />
/**
 * Pre-Discovery Review — embedding worker.
 *
 * Loads Xenova/all-MiniLM-L6-v2 via @huggingface/transformers (WASM by
 * default; WebGPU when available). The model is downloaded once and cached
 * by transformers.js in the browser's cache storage, so subsequent sessions
 * skip the fetch. Indexing runs off the main thread; the worker keeps
 * per-document vector caches in memory for the session.
 *
 * Protocol:
 *   main -> worker:
 *     { kind: "load" }
 *     { kind: "index", id, docKey, chunks: [{ id, page, text }] }
 *     { kind: "query", id, docKey, text, topK }
 *     { kind: "drop", docKey }
 *   worker -> main:
 *     { kind: "loading", stage, progress? }
 *     { kind: "loaded" }
 *     { kind: "index-progress", id, done, total }
 *     { kind: "indexed", id, count }
 *     { kind: "results", id, hits: [{ id, page, score }] }
 *     { kind: "error", id?, message }
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;

type ChunkIn = { id: string; page: number; text: string };
type Extractor = (
  texts: string | string[],
  options: { pooling: "mean" | "cls" | "none"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractorPromise: Promise<Extractor> | null = null;

// docKey -> vectors + chunk metadata (kept in worker memory for session)
const cache = new Map<
  string,
  { dim: number; vectors: Float32Array; chunks: ChunkIn[] }
>();

function post(msg: object, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

async function getExtractor(): Promise<Extractor> {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    post({ kind: "loading", stage: "importing" });
    const tf = await import("@huggingface/transformers");
    // Allow remote model download (default), keep local models off.
    tf.env.allowLocalModels = false;
    const pipe = await tf.pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      {
        progress_callback: (p: { status: string; progress?: number; file?: string }) => {
          post({
            kind: "loading",
            stage: p.status,
            file: p.file,
            progress: typeof p.progress === "number" ? p.progress : undefined,
          });
        },
      },
    );
    post({ kind: "loaded" });
    return pipe as unknown as Extractor;
  })();
  return extractorPromise;
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const ex = await getExtractor();
  const out = await ex(texts, { pooling: "mean", normalize: true });
  const dim = out.dims[out.dims.length - 1];
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(out.data.slice(i * dim, (i + 1) * dim));
  }
  return results;
}

function cosine(a: Float32Array, b: Float32Array, offset: number, dim: number) {
  // Both sides are L2-normalized → cosine == dot product.
  let s = 0;
  for (let i = 0; i < dim; i++) s += a[i] * b[offset + i];
  return s;
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { kind: "load" }
    | { kind: "index"; id: string; docKey: string; chunks: ChunkIn[] }
    | { kind: "query"; id: string; docKey: string; text: string; topK: number }
    | { kind: "drop"; docKey: string };

  try {
    if (msg.kind === "load") {
      await getExtractor();
      return;
    }
    if (msg.kind === "drop") {
      cache.delete(msg.docKey);
      return;
    }
    if (msg.kind === "index") {
      const { id, docKey, chunks } = msg;
      if (chunks.length === 0) {
        cache.set(docKey, { dim: 0, vectors: new Float32Array(0), chunks: [] });
        post({ kind: "indexed", id, count: 0 });
        return;
      }
      await getExtractor();
      const BATCH = 8;
      let dim = 0;
      let vectors: Float32Array | null = null;
      let done = 0;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH);
        const vecs = await embed(batch.map((c) => c.text));
        if (!vectors) {
          dim = vecs[0].length;
          vectors = new Float32Array(dim * chunks.length);
        }
        for (let j = 0; j < vecs.length; j++) {
          vectors.set(vecs[j], (i + j) * dim);
        }
        done += batch.length;
        post({ kind: "index-progress", id, done, total: chunks.length });
      }
      cache.set(docKey, { dim, vectors: vectors!, chunks });
      post({ kind: "indexed", id, count: chunks.length });
      return;
    }
    if (msg.kind === "query") {
      const { id, docKey, text, topK } = msg;
      const entry = cache.get(docKey);
      if (!entry || entry.chunks.length === 0) {
        post({ kind: "results", id, hits: [] });
        return;
      }
      const [qv] = await embed([text]);
      const { dim, vectors, chunks } = entry;
      const scores = new Array<{ i: number; s: number }>(chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        scores[i] = { i, s: cosine(qv, vectors, i * dim, dim) };
      }
      scores.sort((a, b) => b.s - a.s);
      const top = scores.slice(0, topK).map(({ i, s }) => ({
        id: chunks[i].id,
        page: chunks[i].page,
        score: s,
      }));
      post({ kind: "results", id, hits: top });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const id = "id" in (msg as { id?: string }) ? (msg as { id?: string }).id : undefined;
    post({ kind: "error", id, message });
  }
};

export {};
