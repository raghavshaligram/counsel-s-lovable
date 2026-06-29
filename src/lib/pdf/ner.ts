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

type Pipeline = (
  text: string,
  options?: Record<string, unknown>,
) => Promise<Array<{
  entity_group?: string;
  entity?: string;
  word: string;
  start?: number;
  end?: number;
  score: number;
}>>;

let pipelinePromise: Promise<Pipeline | null> | null = null;

async function getPipeline(): Promise<Pipeline | null> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    try {
      const transformers = await importChunk(() => import("@huggingface/transformers"));
      // Force on-device: never reach out to a hosted inference endpoint.
      // Models are fetched once from the Hugging Face CDN and cached by the
      // browser (IndexedDB) for subsequent runs.
      (transformers.env as { allowRemoteModels?: boolean; allowLocalModels?: boolean }).allowRemoteModels = true;
      const pipe = await transformers.pipeline(
        "token-classification",
        "Xenova/bert-base-NER",
        { dtype: "q8" } as unknown as Record<string, unknown>,
      );
      return pipe as unknown as Pipeline;
    } catch (err) {
      // Model fetch / WASM init failures — fall back to regex-only.
      // eslint-disable-next-line no-console
      console.warn("[ner] pipeline init failed — NER disabled", err);
      return null;
    }
  })();
  return pipelinePromise;
}

/**
 * Run NER on a single text string. Returns PERSON / ORG (and LOC / MISC for
 * downstream filtering) entities with character offsets back into the input.
 * Empty / very short inputs short-circuit to [].
 */
export async function runNer(text: string): Promise<NerEntity[]> {
  if (!text || text.trim().length < 4) return [];
  const pipe = await getPipeline();
  if (!pipe) return [];
  const out: NerEntity[] = [];
  try {
    const raw = await pipe(text, { aggregation_strategy: "simple" });
    for (const r of raw) {
      const group = (r.entity_group ?? r.entity ?? "").toUpperCase().replace(/^B-|^I-/, "");
      if (group !== "PER" && group !== "ORG" && group !== "LOC" && group !== "MISC") continue;
      const start = typeof r.start === "number" ? r.start : -1;
      const end = typeof r.end === "number" ? r.end : -1;
      if (start < 0 || end <= start) continue;
      const clean = text.slice(start, end).trim();
      if (clean.length < 2) continue;
      // Confidence filter — the pipeline returns junk on noisy OCR text.
      // PER/ORG use a looser threshold (0.5) so plain-prose names with
      // middle initials or unusual surnames ("Jonathan A. Meriwether",
      // "Sarah Kline", "Acme Holdings") still surface as suggestions.
      // LOC/MISC stay stricter — they're noisier.
      const minScore = group === "PER" || group === "ORG" ? 0.5 : 0.7;
      if ((r.score ?? 0) < minScore) continue;
      out.push({
        type: group as NerEntityType,
        text: clean,
        start,
        end: start + clean.length,
        score: r.score ?? 0,
      });
    }
    // Merge adjacent PER entities separated only by whitespace, a middle
    // initial ("A."), or a hyphen — the tokenizer routinely splits
    // "Jonathan A. Meriwether" into ["Jonathan", "Meriwether"] with the
    // initial as its own token that aggregation_strategy=simple drops.
    // Same for ORG ("Acme Holdings" sometimes splits).
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
    return merged;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ner] run failed", err);
  }
  return out;
}

/**
 * Privilege / confidentiality context terms. These are NOT redaction targets
 * by themselves — they surface for human review because their presence near
 * an unredacted value typically indicates a sensitive passage.
 */
export const PRIVILEGE_TERMS_RE =
  /\b(?:attorney[\s-]client|work[\s-]product|privileged(?:\s+and\s+confidential)?|confidential(?:ity)?|settlement(?:\s+(?:agreement|amount|offer))?|non[\s-]?disclosure|nda|under\s+seal|sealed|in\s+camera|do\s+not\s+disclose|joint\s+defense|common\s+interest)\b/gi;
