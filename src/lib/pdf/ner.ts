/**
 * On-device Named Entity Recognition for PERSON / ORG detection.
 *
 * Uses Transformers.js (Xenova/bert-base-NER, ~110MB ONNX) loaded lazily on
 * first call. The model and pipeline are cached as a module-level promise so
 * subsequent calls reuse the same worker.
 *
 * Findings are SUGGESTIONS — the redaction UI still requires explicit human
 * confirmation before any box is burned in. NER catches plain-prose names
 * that the regex heuristic misses (no Mr./Dr./Esq. title required).
 */
import { importChunk } from "@/lib/chunk-import";

export type NerEntityType = "PER" | "ORG" | "LOC" | "MISC";

export interface NerEntity {
  type: NerEntityType;
  /** The matched text (cleaned of subword markers). */
  text: string;
  /** Character offset within the input string. */
  start: number;
  /** Exclusive end offset within the input string. */
  end: number;
  /** Model confidence 0..1. */
  score: number;
}

type RawEntity = {
  entity_group?: string;
  entity?: string;
  word: string;
  start?: number;
  end?: number;
  score: number;
};

type Pipeline = (
  text: string | string[],
  options?: Record<string, unknown>,
) => Promise<RawEntity[] | RawEntity[][]>;

let pipelinePromise: Promise<Pipeline | null> | null = null;
let activeDevice: "webgpu" | "wasm" | "unknown" = "unknown";

/**
 * Per-scan NER instrumentation. Counters accumulate across ALL calls so
 * detect-pii can snapshot them before/after and log a delta. `callTimings`
 * is capped so long scans don't grow it unboundedly; the aggregate ms /
 * counts remain accurate.
 */
export interface NerStats {
  calls: number;         // number of pipeline() invocations (single or batched)
  batches: number;       // number of batched invocations
  inputs: number;        // number of input strings actually sent to model (post-cache)
  cacheHits: number;     // number of input strings served from the dedup cache
  cacheMisses: number;   // == inputs (for symmetry with hits)
  totalMs: number;       // wall-clock ms across all pipeline() calls
  totalChars: number;    // chars actually sent to the model
  device: "webgpu" | "wasm" | "unknown";
  perCall: Array<{ batchSize: number; chars: number; ms: number }>;
}

const stats: NerStats = {
  calls: 0, batches: 0, inputs: 0, cacheHits: 0, cacheMisses: 0,
  totalMs: 0, totalChars: 0, device: "unknown", perCall: [],
};
const PER_CALL_CAP = 200;

export function getNerStats(): NerStats {
  return { ...stats, device: activeDevice, perCall: stats.perCall.slice() };
}
export function resetNerStats(): void {
  stats.calls = 0; stats.batches = 0; stats.inputs = 0;
  stats.cacheHits = 0; stats.cacheMisses = 0;
  stats.totalMs = 0; stats.totalChars = 0;
  stats.perCall.length = 0;
}

/**
 * LRU dedup cache: hash(joinedText) → post-processed entities. On a
 * boilerplate-heavy filing (repeated captions/headers/footers), the same
 * joined-text string appears on dozens or hundreds of pages. Serving those
 * from cache skips the inference call entirely.
 *
 * Cache keys are FNV-1a 64-bit (as two u32s → hex) of the raw input string.
 * Collisions on 64 bits are astronomically unlikely for scan-sized inputs;
 * a false positive would return entities from an identically-hashed string,
 * which for our use is indistinguishable from a true match.
 */
const NER_CACHE_MAX = 1024;
const nerCache = new Map<string, NerEntity[]>();

function fnv1a64(s: string): string {
  // Two 32-bit lanes to approximate 64-bit FNV-1a in pure JS (no BigInt cost).
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x1b873593 | 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}
function cacheGet(key: string): NerEntity[] | undefined {
  const v = nerCache.get(key);
  if (v !== undefined) {
    // LRU: refresh recency
    nerCache.delete(key);
    nerCache.set(key, v);
  }
  return v;
}
function cacheSet(key: string, value: NerEntity[]): void {
  nerCache.set(key, value);
  if (nerCache.size > NER_CACHE_MAX) {
    const oldest = nerCache.keys().next().value;
    if (oldest !== undefined) nerCache.delete(oldest);
  }
}

async function getPipeline(trigger: string): Promise<Pipeline | null> {
  if (pipelinePromise) return pipelinePromise;
  console.info(
    `%c[ai-model] NER (Xenova/bert-base-NER, ~110MB ONNX) download triggered by: ${trigger}`,
    "color:#4C7FB8;font-weight:bold",
  );
  pipelinePromise = (async () => {
    try {
      const inWorker =
        typeof window === "undefined" ||
        (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined" &&
          (self as unknown) instanceof
            ((globalThis as { WorkerGlobalScope: new () => object }).WorkerGlobalScope));
      const loadWith = async (
        transformers: typeof import("@huggingface/transformers"),
        opts: Record<string, unknown>,
        h: { report: (n: number) => void },
      ) => {
        const perFile = new Map<string, number>();
        return await transformers.pipeline(
          "token-classification",
          "Xenova/bert-base-NER",
          {
            ...opts,
            progress_callback: (p: { status: string; file?: string; progress?: number }) => {
              if (p.file && typeof p.progress === "number") {
                perFile.set(p.file, p.progress);
                let sum = 0;
                for (const v of perFile.values()) sum += v;
                h.report(sum / Math.max(perFile.size, 1) / 100);
              }
            },
          } as unknown as Record<string, unknown>,
        );
      };
      const run = async (h: { report: (n: number) => void }) => {
        const transformers = await importChunk(() => import("@huggingface/transformers"));
        (transformers.env as { allowRemoteModels?: boolean; allowLocalModels?: boolean }).allowRemoteModels = true;
        // WebGPU is 3-10x faster than WASM for BERT-sized token-classification
        // on Chrome/Edge with a discrete or modern integrated GPU. Fall back
        // silently to WASM (q8) on Safari, Firefox, older Chromium, or when
        // adapter init fails at model-compile time.
        const hasWebGpu =
          typeof (globalThis as { navigator?: { gpu?: unknown } }).navigator !== "undefined" &&
          !!(globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu;
        if (hasWebGpu) {
          try {
            const pipe = await loadWith(transformers, { device: "webgpu", dtype: "q8" }, h);
            activeDevice = "webgpu";
            h.report(1);
            console.info(`[ai-model] NER ready on WebGPU (trigger: ${trigger})`);
            return pipe as unknown as Pipeline;
          } catch (err) {
            console.warn("[ner] WebGPU init failed, falling back to WASM", err);
          }
        }
        const pipe = await loadWith(transformers, { dtype: "q8" }, h);
        activeDevice = "wasm";
        h.report(1);
        console.info(`[ai-model] NER ready on WASM (trigger: ${trigger})`);
        return pipe as unknown as Pipeline;
      };
      if (inWorker) {
        // No DOM / no toast when we're running inside a scan worker.
        return await run({ report: () => {} });
      }
      const { notifyModelDownload, getAiCacheStatus } = await import("@/lib/ai/model-download-ui");
      const { nerCached } = await getAiCacheStatus();
      if (nerCached) return await run({ report: () => {} });
      return await notifyModelDownload("AI (bert-base-NER)", "110 MB", run);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[ner] pipeline init failed — NER disabled", err);
      return null;
    }
  })();
  return pipelinePromise;
}

/** Public warm-up — used by the "Pre-download AI models" action. */
export async function prewarmNer(trigger: string): Promise<boolean> {
  const p = await getPipeline(trigger);
  return p != null;
}


/**
 * Run NER on a single text string. Returns PERSON / ORG (and LOC / MISC for
 * downstream filtering) entities with character offsets back into the input.
 * Empty / very short inputs short-circuit to [].
 */
/**
 * Post-process raw pipeline results for a single input `text` into merged
 * NerEntity[] with the same rules used before: score threshold, adjacent-
 * token merge for PER/ORG, all-occurrences sweep. Extracted so both the
 * single-text `runNer` and the batched `runNerBatch` share behavior — a
 * batched call must produce IDENTICAL detections per input to a serial
 * call, otherwise batching would silently drop names.
 */
function postProcessEntities(text: string, raw: RawEntity[]): NerEntity[] {
  const out: NerEntity[] = [];
  for (const r of raw) {
    const group = (r.entity_group ?? r.entity ?? "").toUpperCase().replace(/^B-|^I-/, "");
    if (group !== "PER" && group !== "ORG" && group !== "LOC" && group !== "MISC") continue;
    const start = typeof r.start === "number" ? r.start : -1;
    const end = typeof r.end === "number" ? r.end : -1;
    if (start < 0 || end <= start) continue;
    const clean = text.slice(start, end).trim();
    if (clean.length < 2) continue;
    const minScore = group === "PER" || group === "ORG" ? 0.35 : 0.7;
    if ((r.score ?? 0) < minScore) continue;
    out.push({
      type: group as NerEntityType,
      text: clean,
      start,
      end: start + clean.length,
      score: r.score ?? 0,
    });
  }
  out.sort((a, b) => a.start - b.start);
  const merged: NerEntity[] = [];
  for (const e of out) {
    const last = merged[merged.length - 1];
    if (last && last.type === e.type && (e.type === "PER" || e.type === "ORG")) {
      const between = text.slice(last.end, e.start);
      if (/^[\s,'\-]*(?:[A-Z]\.?\s*)?$/.test(between) && between.length <= 6) {
        last.end = e.end;
        last.text = text.slice(last.start, last.end).trim();
        last.score = Math.min(last.score, e.score);
        continue;
      }
    }
    merged.push(e);
  }
  const seenSpans = new Set(merged.map((e) => `${e.start}:${e.end}`));
  const uniqueByText = new Map<string, NerEntity>();
  for (const e of merged) {
    if (e.type !== "PER" && e.type !== "ORG") continue;
    const key = `${e.type}::${e.text}`;
    if (!uniqueByText.has(key)) uniqueByText.set(key, e);
  }
  for (const proto of uniqueByText.values()) {
    const needle = proto.text;
    if (needle.length < 3) continue;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const s = m.index;
      const eEnd = s + m[0].length;
      const spanKey = `${s}:${eEnd}`;
      if (seenSpans.has(spanKey)) continue;
      seenSpans.add(spanKey);
      merged.push({
        type: proto.type,
        text: needle,
        start: s,
        end: eEnd,
        score: Math.max(0.5, proto.score * 0.9),
      });
    }
  }
  merged.sort((a, b) => a.start - b.start);
  return merged;
}

/**
 * Run NER on a single text string. Returns PERSON / ORG (and LOC / MISC for
 * downstream filtering) entities with character offsets back into the input.
 * Empty / very short inputs short-circuit to [].
 */
export async function runNer(text: string, trigger: string = "runNer"): Promise<NerEntity[]> {
  if (!text || text.trim().length < 4) return [];
  const pipe = await getPipeline(trigger);
  if (!pipe) return [];
  try {
    const raw = (await pipe(text, { aggregation_strategy: "simple" })) as RawEntity[];
    return postProcessEntities(text, raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ner] run failed", err);
    return [];
  }
}

/**
 * Batched NER — runs one pipeline inference across MANY input strings at
 * once. Transformer models are massively more efficient batched: on a large
 * scan, batching pages 8-at-a-time cuts per-page cost by roughly the batch
 * factor after model warmup. Falls back to per-input serial calls if the
 * pipeline runtime doesn't support array input in this build.
 *
 * Returns entities[i] corresponding to texts[i]. Empty inputs yield [].
 */
export async function runNerBatch(texts: string[], trigger: string = "runNerBatch"): Promise<NerEntity[][]> {
  const results: NerEntity[][] = texts.map(() => []);
  const activeIdx: number[] = [];
  const activeTexts: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (t && t.trim().length >= 4) {
      activeIdx.push(i);
      activeTexts.push(t);
    }
  }
  if (activeTexts.length === 0) return results;
  const pipe = await getPipeline(trigger);
  if (!pipe) return results;
  try {
    const raw = (await pipe(activeTexts, { aggregation_strategy: "simple" })) as
      | RawEntity[]
      | RawEntity[][];
    // Some runtimes flatten a single-input array into a bare RawEntity[]; treat that as one group.
    const grouped: RawEntity[][] = Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])
      ? (raw as RawEntity[][])
      : activeTexts.length === 1
        ? [raw as RawEntity[]]
        : // Runtime returned a flat list for multi-input — best-effort fallback: run serially.
          [];
    if (grouped.length !== activeTexts.length) {
      // Fallback to serial per-input calls; still one inference per input, no offset drift.
      for (let k = 0; k < activeTexts.length; k++) {
        const single = (await pipe(activeTexts[k], { aggregation_strategy: "simple" })) as RawEntity[];
        results[activeIdx[k]] = postProcessEntities(activeTexts[k], single);
      }
      return results;
    }
    for (let k = 0; k < grouped.length; k++) {
      results[activeIdx[k]] = postProcessEntities(activeTexts[k], grouped[k]);
    }
    return results;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ner] batch run failed, falling back to serial", err);
    for (let k = 0; k < activeTexts.length; k++) {
      try {
        const single = (await pipe(activeTexts[k], { aggregation_strategy: "simple" })) as RawEntity[];
        results[activeIdx[k]] = postProcessEntities(activeTexts[k], single);
      } catch {
        results[activeIdx[k]] = [];
      }
    }
    return results;
  }
}

/**
 * Privilege / confidentiality context terms. These are NOT redaction targets
 * by themselves — they surface for human review because their presence near
 * an unredacted value typically indicates a sensitive passage.
 */
export const PRIVILEGE_TERMS_RE =
  /\b(?:attorney[\s-]client|work[\s-]product|privileged(?:\s+and\s+confidential)?|confidential(?:ity)?|settlement(?:\s+(?:agreement|amount|offer))?|non[\s-]?disclosure|nda|under\s+seal|sealed|in\s+camera|do\s+not\s+disclose|joint\s+defense|common\s+interest)\b/gi;
