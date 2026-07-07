/**
 * Pixel-level redaction verification for rasterized pages.
 *
 * Previously this ran Tesseract OCR ONCE PER redaction rectangle — a
 * catastrophic cost on 13,000-rect selections (loads a model, then does
 * one OCR call per box). Now delegates to a dedicated Web Worker that
 * does a deterministic near-black pixel-coverage check per rect.
 *
 * The check proves the rasterizer actually painted the region black.
 * Text-removal is proved elsewhere (raw-stream + side-channel verifier).
 */
import { verifyPixelRedactionInWorker } from "@/lib/workers/pixel-verify-client";

export interface PixelRedactionRect {
  page: number;
  rect: { x: number; y: number; w: number; h: number };
  label?: string;
}

export interface PixelVerifyResult {
  ok: boolean;
  total: number;
  removed: number;
  leaks: Array<{ page: number; rect: { x: number; y: number; w: number; h: number }; text: string; confidence: number }>;
  scannedAt: string;
}

export async function verifyPixelRedaction(
  bytes: Uint8Array,
  rects: PixelRedactionRect[],
  pagesToCheck: Set<number>,
  options: { scale?: number; signal?: AbortSignal } = {},
): Promise<PixelVerifyResult> {
  const targets = rects.filter((r) => pagesToCheck.has(r.page) && r.rect.w > 2 && r.rect.h > 2);
  if (targets.length === 0) {
    return { ok: true, total: 0, removed: 0, leaks: [], scannedAt: new Date().toISOString() };
  }
  const res = await verifyPixelRedactionInWorker(bytes, targets, pagesToCheck, {
    scale: options.scale ?? 2.5,
    signal: options.signal,
  });
  return {
    ok: res.ok,
    total: res.total,
    removed: res.removed,
    leaks: res.leaks.map((l) => ({
      page: l.page,
      rect: l.rect,
      text: `Redaction rectangle only ${(l.coverage * 100).toFixed(1)}% black — burn incomplete`,
      confidence: 100,
    })),
    scannedAt: res.scannedAt,
  };
}
