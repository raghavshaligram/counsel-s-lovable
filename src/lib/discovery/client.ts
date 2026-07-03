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
    const { notifyModelDownload } = await import("@/lib/ai/model-download-ui");
    return notifyModelDownload("AI (MiniLM)", "45 MB", (h) =>
      new Promise<void>((resolve, reject) => {
        const w = getWorker();
        const handler = (e: MessageEvent) => {
          const m = e.data;
          if (m?.kind === "loading") {
            onProgress?.(m);
            if (typeof m.progress === "number") h.report(m.progress);
          } else if (m?.kind === "loaded") {
            modelLoaded = true;
            console.info(`[ai-model] MiniLM ready (trigger: ${trigger})`);
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
      }),
    );
  })();
  return modelLoading;
}

let reqCounter = 0;
export function indexDocument(
  docKey: string,
  chunks: DiscoveryChunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const w = getWorker();
  chunkStore.set(docKey, chunks);
  const id = `idx-${++reqCounter}`;
  return new Promise<number>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m?.id !== id) return;
      if (m.kind === "index-progress") onProgress?.(m.done, m.total);
      else if (m.kind === "indexed") {
        indexedDocs.add(docKey);
        w.removeEventListener("message", handler);
        resolve(m.count as number);
      } else if (m.kind === "error") {
        w.removeEventListener("message", handler);
        reject(new Error(m.message));
      }
    };
    w.addEventListener("message", handler);
    w.postMessage({
      kind: "index",
      id,
      docKey,
      chunks: chunks.map(({ id: cid, page, text }) => ({ id: cid, page, text })),
    });
  });
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
