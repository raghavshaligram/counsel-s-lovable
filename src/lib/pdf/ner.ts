/**
 * On-device Named Entity Recognition for PERSON / ORG detection.
 *
 * Two execution modes share the same model + post-processing:
 *
 *  - `runNer(text)` — legacy in-thread path. Used by callers that don't
 *    have a worker available (tests, fallback).
 *  - `runNerWorkerBatch(texts)` — preferred. Runs in a dedicated Web Worker
 *    so the main thread stays responsive while the 110 MB ONNX model warms
 *    up and runs. The model loads ONCE per worker.
 *
 * Findings are SUGGESTIONS — the redaction UI still requires explicit human
 * confirmation before any box is burned in.
 */
import { importChunk } from "@/lib/chunk-import";

export type NerEntityType = "PER" | "ORG" | "LOC" | "MISC";

export interface NerEntity {
  type: NerEntityType;
  text: string;
  start: number;
  end: number;
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
  text: string,
  options?: Record<string, unknown>,
) => Promise<RawEntity[]>;

let pipelinePromise: Promise<Pipeline | null> | null = null;

async function getPipeline(): Promise<Pipeline | null> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    try {
      const transformers = await importChunk(() => import("@huggingface/transformers"));
      (transformers.env as { allowRemoteModels?: boolean; allowLocalModels?: boolean }).allowRemoteModels = true;
      const pipe = await transformers.pipeline(
        "token-classification",
        "Xenova/bert-base-NER",
        { dtype: "q8" } as unknown as Record<string, unknown>,
      );
      return pipe as unknown as Pipeline;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[ner] pipeline init failed — NER disabled", err);
      return null;
    }
  })();
  return pipelinePromise;
}

/**
 * Shared post-processor: takes raw HF token-classification output and the
 * source text, returns merged + all-occurrences NerEntity[]. Used by both
 * the in-thread and worker-backed code paths.
 */
export function processRawEntities(text: string, raw: RawEntity[]): NerEntity[] {
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
  // ALL-OCCURRENCES sweep.
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

/** In-thread NER for a single string. Slow — prefer runNerWorkerBatch. */
export async function runNer(text: string): Promise<NerEntity[]> {
  if (!text || text.trim().length < 4) return [];
  const pipe = await getPipeline();
  if (!pipe) return [];
  try {
    const raw = await pipe(text, { aggregation_strategy: "simple" });
    return processRawEntities(text, raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ner] run failed", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Worker-backed batch path. The worker loads the model ONCE and processes
// requests sequentially; the model is the bottleneck, so a single worker is
// sufficient (multiple workers = N copies of a 110 MB model in RAM).
// ---------------------------------------------------------------------------

type PendingResolver = (value: { results?: RawEntity[][]; error?: string }) => void;

let nerWorker: Worker | null = null;
let nerCounter = 0;
const nerPending = new Map<number, PendingResolver>();

function ensureWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (nerWorker) return nerWorker;
  try {
    nerWorker = new Worker(new URL("./ner.worker.ts", import.meta.url), {
      type: "module",
      name: "vaultpdf-ner",
    });
    nerWorker.onmessage = (e: MessageEvent) => {
      const { id, results, error } = e.data ?? {};
      const cb = nerPending.get(id);
      if (!cb) return;
      nerPending.delete(id);
      cb({ results, error });
    };
    nerWorker.onerror = (e) => {
      // eslint-disable-next-line no-console
      console.warn("[ner.worker] error", e.message);
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ner.worker] spawn failed — falling back to in-thread", err);
    return null;
  }
  return nerWorker;
}

/**
 * Run NER on a batch of text strings inside a Web Worker. Returns one
 * NerEntity[] per input, in order. Falls back to in-thread runNer if the
 * worker can't be spawned (SSR, old browser).
 */
export async function runNerWorkerBatch(texts: string[]): Promise<NerEntity[][]> {
  if (texts.length === 0) return [];
  const w = ensureWorker();
  if (!w) {
    // Fallback: sequential in-thread.
    const out: NerEntity[][] = [];
    for (const t of texts) out.push(await runNer(t));
    return out;
  }
  const id = ++nerCounter;
  const reply = await new Promise<{ results?: RawEntity[][]; error?: string }>((resolve) => {
    nerPending.set(id, resolve);
    w.postMessage({ id, texts });
  });
  if (reply.error || !reply.results) {
    return texts.map(() => []);
  }
  return reply.results.map((raw, i) => processRawEntities(texts[i] ?? "", raw ?? []));
}

/**
 * Privilege / confidentiality context terms.
 */
export const PRIVILEGE_TERMS_RE =
  /\b(?:attorney[\s-]client|work[\s-]product|privileged(?:\s+and\s+confidential)?|confidential(?:ity)?|settlement(?:\s+(?:agreement|amount|offer))?|non[\s-]?disclosure|nda|under\s+seal|sealed|in\s+camera|do\s+not\s+disclose|joint\s+defense|common\s+interest)\b/gi;
