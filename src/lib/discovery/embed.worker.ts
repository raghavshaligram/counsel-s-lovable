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
 *     { kind: "debug", line }
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

function debug(line: string, data?: unknown) {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  post({ kind: "debug", line: `[discovery-worker] ${line}${suffix}` });
}

async function getExtractor(): Promise<Extractor> {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    console.log("[discovery-worker] loading @huggingface/transformers…");
    debug("loading @huggingface/transformers…");
    post({ kind: "loading", stage: "importing" });
    let tf;
    try {
      tf = await import("@huggingface/transformers");
    } catch (err) {
      console.error("[discovery-worker] FAILED to import transformers", err);
      debug("FAILED to import transformers", err instanceof Error ? err.message : String(err));
      throw err;
    }
    tf.env.allowLocalModels = false;
    let pipe;
    try {
      pipe = await tf.pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        {
          progress_callback: (p: { status: string; progress?: number; file?: string }) => {
            if (p.status === "ready" || p.status === "done" || p.status === "initiate") {
              console.log("[discovery-worker] model load stage:", p.status, p.file ?? "");
              debug("model load stage", { status: p.status, file: p.file ?? "" });
            }
            post({
              kind: "loading",
              stage: p.status,
              file: p.file,
              progress: typeof p.progress === "number" ? p.progress : undefined,
            });
          },
        },
      );
    } catch (err) {
      console.error("[discovery-worker] FAILED to load MiniLM pipeline", err);
      debug("FAILED to load MiniLM pipeline", err instanceof Error ? err.message : String(err));
      throw err;
    }
    console.log("[discovery-worker] ✓ MiniLM extractor ready (Xenova/all-MiniLM-L6-v2)");
    debug("✓ MiniLM extractor ready", { model: "Xenova/all-MiniLM-L6-v2" });
    // Sanity probe: embed a fixed string and log dim + norm.
    try {
      const probe = await (pipe as unknown as Extractor)(["hello world"], { pooling: "mean", normalize: true });
      const dim = probe.dims[probe.dims.length - 1];
      let sq = 0;
      for (let i = 0; i < dim; i++) sq += probe.data[i] * probe.data[i];
      console.log("[discovery-worker] ✓ probe embedding dim=", dim, " ||v||=", Math.sqrt(sq).toFixed(4));
      debug("✓ probe embedding", { dim, norm: +Math.sqrt(sq).toFixed(4) });
    } catch (err) {
      console.error("[discovery-worker] probe embed failed", err);
      debug("probe embed failed", err instanceof Error ? err.message : String(err));
    }
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
    | { kind: "embed"; id: string; texts: string[] }
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
    if (msg.kind === "embed") {
      const { id, texts } = msg;
      if (texts.length === 0) {
        post({ kind: "embedded", id, dim: 0, buffer: new Float32Array(0).buffer });
        return;
      }
      const vecs = await embed(texts);
      const dim = vecs[0].length;
      const out = new Float32Array(dim * texts.length);
      for (let i = 0; i < vecs.length; i++) out.set(vecs[i], i * dim);
      post({ kind: "embedded", id, dim, buffer: out.buffer }, [out.buffer]);
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
      console.log("[discovery-worker] indexing", chunks.length, "chunks for", docKey);
      debug("indexing chunks", { count: chunks.length, docKey });
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
          // Log first chunk vector shape + norm to prove embeddings ran.
          let sq = 0;
          for (let k = 0; k < dim; k++) sq += vecs[0][k] * vecs[0][k];
          console.log(
            "[discovery-worker] ✓ first chunk embedded — dim=", dim,
            " ||v||=", Math.sqrt(sq).toFixed(4),
            " page=", batch[0].page,
            " textHead=", JSON.stringify(batch[0].text.slice(0, 60)),
          );
          debug("✓ first chunk embedded", {
            dim,
            norm: +Math.sqrt(sq).toFixed(4),
            page0: batch[0].page,
            page1: batch[0].page + 1,
            textHead: batch[0].text.slice(0, 90),
          });
        }
        for (let j = 0; j < vecs.length; j++) {
          vectors.set(vecs[j], (i + j) * dim);
        }
        done += batch.length;
        post({ kind: "index-progress", id, done, total: chunks.length });
      }
      console.log("[discovery-worker] ✓ indexed", chunks.length, "chunks, dim=", dim);
      debug("✓ indexed chunks", { count: chunks.length, dim });
      cache.set(docKey, { dim, vectors: vectors!, chunks });
      post({ kind: "indexed", id, count: chunks.length });
      return;
    }
    if (msg.kind === "query") {
      const { id, docKey, text, topK } = msg;
      const entry = cache.get(docKey);
      if (!entry || entry.chunks.length === 0) {
        console.warn("[discovery-worker] query with no index for", docKey);
        post({ kind: "results", id, hits: [] });
        return;
      }
      const [qv] = await embed([text]);
      let qsq = 0;
      for (let k = 0; k < qv.length; k++) qsq += qv[k] * qv[k];
      console.log(
        "[discovery-worker] ✓ query embedded", JSON.stringify(text),
        " dim=", qv.length, " ||q||=", Math.sqrt(qsq).toFixed(4),
      );
      debug("✓ query embedded", {
        query: text,
        dim: qv.length,
        norm: +Math.sqrt(qsq).toFixed(4),
        ranking: "cosine(MiniLM embeddings)",
      });
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
      console.log(
        "[discovery-worker] ✓ cosine ranked",
        chunks.length, "chunks — top5:",
        scores.slice(0, 5).map((x) => ({
          page: chunks[x.i].page,
          score: +x.s.toFixed(3),
          head: chunks[x.i].text.slice(0, 50),
        })),
      );
      debug("✓ cosine ranked top5", scores.slice(0, 5).map((x) => ({
        page0: chunks[x.i].page,
        page1: chunks[x.i].page + 1,
        score: +x.s.toFixed(3),
        textHead: chunks[x.i].text.slice(0, 120),
      })));
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
