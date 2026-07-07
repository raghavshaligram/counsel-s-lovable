/**
 * Main-thread client for the Pre-Discovery embedding worker.
 * Owns the singleton Worker, load state, per-doc chunk store, and a
 * simple request/response over postMessage.
 */

import type { PdfChunk } from "@/lib/chat/pdf-extract";

export type LoadStage = string;
export interface DiscoveryChunk extends PdfChunk {
  id: string; // stable id: `${page}:${index}`
}
export interface Hit {
  id: string;
  page: number;
  score: number;
  text: string;
}

const debugLines: string[] = [];
const debugListeners = new Set<(lines: string[]) => void>();

function pushDebug(line: string) {
  debugLines.push(`${new Date().toISOString()} ${line}`);
  if (debugLines.length > 160) debugLines.splice(0, debugLines.length - 160);
  const snapshot = [...debugLines];
  debugListeners.forEach((listener) => listener(snapshot));
}

export function addDiscoveryDebug(line: string, data?: unknown) {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  pushDebug(`[pre-discovery] ${line}${suffix}`);
}

export function getDiscoveryDebugLines(): string[] {
  return [...debugLines];
}

export function subscribeDiscoveryDebug(listener: (lines: string[]) => void): () => void {
  debugListeners.add(listener);
  listener([...debugLines]);
  return () => debugListeners.delete(listener);
}

let worker: Worker | null = null;
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./embed.worker.ts", import.meta.url), {
    type: "module",
    name: "counselpdf-discovery",
  });
  worker.addEventListener("message", (e: MessageEvent) => {
    const m = e.data;
    if (m?.kind === "debug" && typeof m.line === "string") pushDebug(m.line);
  });
  return worker;
}

// Per-doc chunk metadata so the main thread can render passage text
// without shipping vectors back and forth.
const chunkStore = new Map<string, DiscoveryChunk[]>();
const indexedDocs = new Set<string>();

export function hasIndex(docKey: string): boolean {
  return indexedDocs.has(docKey);
}
export function getChunks(docKey: string): DiscoveryChunk[] | undefined {
  return chunkStore.get(docKey);
}

let modelLoaded = false;
let modelLoading: Promise<void> | null = null;

export type LoadProgress = {
  stage: string;
  file?: string;
  progress?: number;
};

export function loadModel(
  onProgress?: (p: LoadProgress) => void,
  trigger: string = "unknown",
): Promise<void> {
  if (modelLoaded) return Promise.resolve();
  if (modelLoading) {
    console.info(`[ai-model] MiniLM already loading — join (trigger: ${trigger})`);
    return modelLoading;
  }
  console.info(
    `%c[ai-model] MiniLM (Xenova/all-MiniLM-L6-v2, ~22MB + ONNX runtime ~22MB) download triggered by: ${trigger}`,
    "color:#4C7FB8;font-weight:bold",
  );
  addDiscoveryDebug(`MiniLM download triggered by: ${trigger}`);
  modelLoading = (async () => {
    const { notifyModelDownload, getAiCacheStatus } = await import("@/lib/ai/model-download-ui");
    // Skip the download toast entirely when the MiniLM asset is already in
    // Cache Storage — warm loads only re-initialize the ONNX runtime and
    // should never look like a fresh download to the user.
    const { minilmCached } = await getAiCacheStatus();
    const run = (h: { report: (n: number) => void }) =>
      new Promise<void>((resolve, reject) => {
        const w = getWorker();
        const handler = (e: MessageEvent) => {
          const m = e.data;
          if (m?.kind === "loading") {
            onProgress?.(m);
            if (typeof m.progress === "number") h.report(m.progress);
          } else if (m?.kind === "loaded") {
            modelLoaded = true;
            console.info(`[ai-model] MiniLM ready (trigger: ${trigger}, cached: ${minilmCached})`);
            h.report(100);
            w.removeEventListener("message", handler);
            resolve();
          } else if (m?.kind === "error" && !m.id) {
            w.removeEventListener("message", handler);
            reject(new Error(m.message));
          }
        };
        w.addEventListener("message", handler);
        w.postMessage({ kind: "load" });
      });
    if (minilmCached) {
      // No toast, no progress UI — cached warm-start.
      return run({ report: () => {} });
    }
    return notifyModelDownload("AI (MiniLM)", "45 MB", run);
  })();
  return modelLoading;
}

let reqCounter = 0;

/**
 * Track in-flight indexDocument runs so a duplicate call for the same
 * docKey no-ops instead of stacking a second worker pass — a major
 * contributor to the "app goes into indexing mode forever" bug.
 */
const inflightIndex = new Map<string, Promise<number>>();
/** Track abort callbacks per in-flight index request id. */
const indexAbortHandlers = new Map<string, () => void>();

export function indexDocument(
  docKey: string,
  chunks: DiscoveryChunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const existing = inflightIndex.get(docKey);
  if (existing) {
    console.info(`[ai-model] indexDocument already running for ${docKey} — joining`);
    return existing;
  }

  const w = getWorker();
  chunkStore.set(docKey, chunks);
  const id = `idx-${++reqCounter}`;

  const promise = (async (): Promise<number> => {
    // 1. Try to hydrate from IndexedDB — skips the entire embedding pass.
    try {
      const { loadCachedIndex } = await import("./index-cache");
      const cached = await loadCachedIndex(docKey);
      if (cached && cached.chunks.length === chunks.length) {
        const buf = cached.vectors.buffer.slice(0);
        w.postMessage(
          { kind: "hydrate", docKey, dim: cached.dim, vectors: buf, chunks: cached.chunks },
          [buf],
        );
        indexedDocs.add(docKey);
        console.info(`[ai-model] hydrated cached index for ${docKey} (${cached.chunks.length} chunks)`);
        onProgress?.(cached.chunks.length, cached.chunks.length);
        return cached.chunks.length;
      }
    } catch (err) {
      console.warn("[ai-model] cache hydrate failed (non-fatal)", err);
    }

    // 2. Fall back to a fresh index pass in the worker.
    return await new Promise<number>((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        const m = e.data;
        if (m?.id !== id) return;
        if (m.kind === "index-progress") onProgress?.(m.done, m.total);
        else if (m.kind === "indexed") {
          indexedDocs.add(docKey);
          w.removeEventListener("message", handler);
          // Best-effort persist to IndexedDB so re-opens skip the work.
          try {
            const dim = m.dim as number;
            const vectors = new Float32Array(m.vectors as ArrayBuffer);
            const chunkMeta = m.chunks as { id: string; page: number; text: string }[];
            void import("./index-cache").then(({ saveCachedIndex }) =>
              saveCachedIndex(docKey, { dim, vectors, chunks: chunkMeta }),
            );
          } catch { /* ignore */ }
          resolve(m.count as number);
        } else if (m.kind === "index-aborted") {
          w.removeEventListener("message", handler);
          reject(new Error("aborted"));
        } else if (m.kind === "error") {
          w.removeEventListener("message", handler);
          reject(new Error(m.message));
        }
      };
      w.addEventListener("message", handler);
      indexAbortHandlers.set(id, () => {
        w.postMessage({ kind: "abort", id });
      });
      w.postMessage({
        kind: "index",
        id,
        docKey,
        chunks: chunks.map(({ id: cid, page, text }) => ({ id: cid, page, text })),
      });
    });
  })().finally(() => {
    inflightIndex.delete(docKey);
    indexAbortHandlers.delete(id);
  });

  inflightIndex.set(docKey, promise);
  return promise;
}

/**
 * Abort every in-flight indexDocument call for the given docKey (or all
 * of them if no docKey is provided). Returns true when at least one
 * pending run was signalled — the caller can toast "Indexing paused".
 */
export function abortIndex(docKey?: string): boolean {
  let hit = false;
  if (docKey) {
    if (!inflightIndex.has(docKey)) return false;
    for (const [, cancel] of indexAbortHandlers) {
      cancel();
      hit = true;
    }
    return hit;
  }
  for (const [, cancel] of indexAbortHandlers) {
    cancel();
    hit = true;
  }
  return hit;
}

/** True while a fresh index pass (not a cache hydrate) is running for docKey. */
export function isIndexing(docKey: string): boolean {
  return inflightIndex.has(docKey);
}


export function queryIndex(
  docKey: string,
  text: string,
  topK = 8,
): Promise<Hit[]> {
  const w = getWorker();
  const chunks = chunkStore.get(docKey) ?? [];
  const id = `q-${++reqCounter}`;
  return new Promise<Hit[]>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m?.id !== id) return;
      if (m.kind === "results") {
        w.removeEventListener("message", handler);
        const byId = new Map(chunks.map((c) => [c.id, c]));
        resolve(
          (m.hits as Array<{ id: string; page: number; score: number }>).map(
            (h) => ({ ...h, text: byId.get(h.id)?.text ?? "" }),
          ),
        );
      } else if (m.kind === "error") {
        w.removeEventListener("message", handler);
        reject(new Error(m.message));
      }
    };
    w.addEventListener("message", handler);
    w.postMessage({ kind: "query", id, docKey, text, topK });
  });
}

/**
 * Embed arbitrary texts on-device using the already-loaded MiniLM model.
 * Reused by the command-bar intent router — no separate model download.
 * Returns L2-normalized 384-dim vectors (cosine == dot product).
 */
export async function embedTexts(
  texts: string[],
  trigger: string = "embedTexts",
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  await loadModel(undefined, trigger);
  const w = getWorker();
  const id = `emb-${++reqCounter}`;
  return new Promise<Float32Array[]>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m?.id !== id) return;
      if (m.kind === "embedded") {
        w.removeEventListener("message", handler);
        const { dim, buffer } = m as { dim: number; buffer: ArrayBuffer };
        if (dim === 0) return resolve([]);
        const flat = new Float32Array(buffer);
        const out: Float32Array[] = [];
        for (let i = 0; i < texts.length; i++) {
          out.push(flat.slice(i * dim, (i + 1) * dim));
        }
        resolve(out);
      } else if (m.kind === "error") {
        w.removeEventListener("message", handler);
        reject(new Error(m.message));
      }
    };
    w.addEventListener("message", handler);
    w.postMessage({ kind: "embed", id, texts });
  });
}

export function isModelLoaded(): boolean {
  return modelLoaded;
}

export function dropIndex(docKey: string): void {
  if (!worker) return;
  chunkStore.delete(docKey);
  indexedDocs.delete(docKey);
  worker.postMessage({ kind: "drop", docKey });
}

/**
 * Drop every in-memory index and its ~14 MB chunk-text pin. Called on tab
 * close (beforeunload / pagehide) so a large document doesn't hold RAM
 * for the tab's lifetime once the user has navigated away.
 */
export function dropAllIndexes(): void {
  const keys = Array.from(chunkStore.keys());
  chunkStore.clear();
  indexedDocs.clear();
  if (worker) {
    for (const k of keys) worker.postMessage({ kind: "drop", docKey: k });
  }
}

if (typeof window !== "undefined") {
  const evict = () => dropAllIndexes();
  window.addEventListener("pagehide", evict);
  window.addEventListener("beforeunload", evict);
}

/** Rough device capability probe — refuses tiny devices up front. */
export function capabilityCheck(): { ok: boolean; reason?: string } {
  if (typeof Worker === "undefined")
    return { ok: false, reason: "Web Workers are not available in this browser." };
  if (typeof WebAssembly === "undefined")
    return { ok: false, reason: "WebAssembly is required and not available." };
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 2)
    return {
      ok: false,
      reason: `On-device AI needs ≥ 2 GB RAM; this device reports ${nav.deviceMemory} GB.`,
    };
  return { ok: true };
}
