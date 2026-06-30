/// <reference lib="webworker" />
/**
 * NER Web Worker — runs Xenova/bert-base-NER off the main thread so the UI
 * never freezes during PII detection. The model loads ONCE per worker and is
 * reused for every subsequent request.
 *
 * Protocol:
 *   main -> worker: { id: number, texts: string[] }
 *   worker -> main: { id, ready?: boolean }                 // model ready
 *   worker -> main: { id, results: RawEntity[][] }
 *   worker -> main: { id, error: string }
 *
 * Post-processing (offset merge, all-occurrences sweep) happens in the main
 * thread (see ner.ts processRawEntities) so the worker stays a thin wrapper.
 */

type RawEntity = {
  entity_group?: string;
  entity?: string;
  word: string;
  start?: number;
  end?: number;
  score: number;
};

let pipelinePromise: Promise<((t: string, o?: Record<string, unknown>) => Promise<RawEntity[]>) | null> | null = null;

async function getPipeline() {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    try {
      const transformers = await import("@huggingface/transformers");
      (transformers.env as { allowRemoteModels?: boolean; allowLocalModels?: boolean }).allowRemoteModels = true;
      const pipe = await transformers.pipeline(
        "token-classification",
        "Xenova/bert-base-NER",
        { dtype: "q8" } as unknown as Record<string, unknown>,
      );
      return pipe as unknown as (t: string, o?: Record<string, unknown>) => Promise<RawEntity[]>;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[ner.worker] pipeline init failed", err);
      return null;
    }
  })();
  return pipelinePromise;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = e.data;
  try {
    const pipe = await getPipeline();
    if (!pipe) {
      ctx.postMessage({ id, results: texts.map(() => []) });
      return;
    }
    // Run sequentially inside the worker — the underlying ONNX runtime is
    // single-threaded for q8 inference, so parallel calls would just thrash.
    const results: RawEntity[][] = [];
    for (const t of texts) {
      if (!t || t.trim().length < 4) {
        results.push([]);
        continue;
      }
      try {
        const raw = await pipe(t, { aggregation_strategy: "simple" });
        results.push(raw);
      } catch {
        results.push([]);
      }
    }
    ctx.postMessage({ id, results });
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

export {};
