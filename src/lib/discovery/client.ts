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

let worker: Worker | null = null;
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./embed.worker.ts", import.meta.url), {
    type: "module",
    name: "counselpdf-discovery",
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

export function loadModel(onProgress?: (p: LoadProgress) => void): Promise<void> {
  if (modelLoaded) return Promise.resolve();
  if (modelLoading) return modelLoading;
  const w = getWorker();
  modelLoading = new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m?.kind === "loading") onProgress?.(m);
      else if (m?.kind === "loaded") {
        modelLoaded = true;
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
