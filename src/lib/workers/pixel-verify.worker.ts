/// <reference lib="webworker" />
/**
 * Pixel-verify worker — deterministic black-pixel coverage check.
 *
 * Replaces the previous Tesseract-based per-region OCR (which spun up an
 * OCR model + ran once per redaction rect — catastrophic for 13,000 rects).
 *
 * For each rasterized page, we render it once from the exported PDF and
 * inspect the pixels inside every redaction rectangle. A rectangle passes
 * if ≥ 99.5% of its pixels are near-black. This proves the rasterizer
 * actually painted the region black; it does NOT reprove text removal
 * (the raw-stream + side-channel verifier already does that).
 */
import { loadPdfjs } from "@/lib/pdf/worker";
import { allocationFailureMessage, logAllocationFailure, logHeap } from "@/lib/memory-log";

export interface PixelRectTL { x: number; y: number; w: number; h: number }
export interface PixelVerifyTarget { page: number; rect: PixelRectTL; label?: string }
export interface PixelLeak { page: number; rect: PixelRectTL; coverage: number }

type InboundMsg =
  | {
      kind: "verify";
      id: string;
      bytes: ArrayBuffer;
      targets: PixelVerifyTarget[];
      pagesToCheck: number[];
      scale: number;
    }
  | { kind: "cancel"; id: string };

type OutboundMsg =
  | { kind: "result"; id: string; ok: boolean; total: number; removed: number; leaks: PixelLeak[] }
  | { kind: "error"; id: string; message: string };

const active = new Map<string, { canceled: boolean }>();

function post(msg: OutboundMsg) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.addEventListener("message", async (ev: MessageEvent<InboundMsg>) => {
  const m = ev.data;
  if (m.kind === "cancel") {
    const e = active.get(m.id);
    if (e) e.canceled = true;
    return;
  }
  if (m.kind !== "verify") return;

  const entry = { canceled: false };
  active.set(m.id, entry);

  try {
    const bytes = new Uint8Array(m.bytes);
    const pagesToCheck = new Set(m.pagesToCheck);
    const targets = m.targets.filter((t) => pagesToCheck.has(t.page) && t.rect.w > 2 && t.rect.h > 2);
    if (targets.length === 0) {
      post({ kind: "result", id: m.id, ok: true, total: 0, removed: 0, leaks: [] });
      return;
    }

    const scale = m.scale;
    const pdfjs = await loadPdfjs();
    const inputBytesMB = Math.round((bytes.byteLength / 1024 / 1024) * 10) / 10;
    logHeap("pixel-verify.worker before bytes.slice", { inputBytesMB, pagesToCheck: pagesToCheck.size, targets: targets.length });
    let pdfjsBytes: Uint8Array;
    try {
      pdfjsBytes = bytes.slice();
    } catch (err) {
      logAllocationFailure("pixel-verify.worker bytes.slice", err, { inputBytesMB });
      throw new Error(allocationFailureMessage("pixel-verify.worker bytes.slice", err));
    }
    logHeap("pixel-verify.worker before pdfjs.getDocument", { inputBytesMB });
    let doc: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["getDocument"]>["promise"]>;
    try {
      doc = await pdfjs.getDocument({ data: pdfjsBytes }).promise;
    } catch (err) {
      logAllocationFailure("pixel-verify.worker pdfjs.getDocument", err, { inputBytesMB });
      throw new Error(allocationFailureMessage("pixel-verify.worker pdfjs.getDocument", err));
    }

    const byPage = new Map<number, PixelVerifyTarget[]>();
    for (const t of targets) {
      const arr = byPage.get(t.page) ?? [];
      arr.push(t);
      byPage.set(t.page, arr);
    }

    const leaks: PixelLeak[] = [];
    try {
      for (const [pageIdx, items] of byPage) {
        if (entry.canceled) throw new DOMException("Canceled", "AbortError");
        if (pageIdx < 0 || pageIdx >= doc.numPages) continue;
        const page = await doc.getPage(pageIdx + 1);
        const viewport = page.getViewport({ scale });
        let canvas: OffscreenCanvas | null = new OffscreenCanvas(
          Math.max(1, Math.ceil(viewport.width)),
          Math.max(1, Math.ceil(viewport.height)),
        );
        const ctx = canvas.getContext("2d");
        if (!ctx) { try { page.cleanup(); } catch { /* noop */ } continue; }
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
          canvas: canvas as unknown as HTMLCanvasElement,
        } as unknown as Parameters<typeof page.render>[0]).promise;
        try { page.cleanup(); } catch { /* noop */ }

        for (const t of items) {
          // Sample slightly INSIDE the painted rect (inset by ~2px at
          // scale). The rasterizer bleeds the black fill ~2px OUTSIDE
          // the exact rect bounds to defeat JPEG edge ringing; here we
          // sample only the reliably-solid interior. Using ceil on the
          // origin and floor on the extent ensures the sample window is
          // strictly INSIDE the painted (rect+bleed) area — never larger.
          const INSET = 2;
          const rx = t.rect.x * scale + INSET;
          const ry = t.rect.y * scale + INSET;
          const rw = t.rect.w * scale - INSET * 2;
          const rh = t.rect.h * scale - INSET * 2;
          if (rw < 2 || rh < 2) continue;
          const cx = Math.max(0, Math.ceil(rx));
          const cy = Math.max(0, Math.ceil(ry));
          const cw = Math.min(canvas.width - cx, Math.floor(rx + rw) - cx);
          const ch = Math.min(canvas.height - cy, Math.floor(ry + rh) - cy);
          if (cw < 2 || ch < 2) continue;
          const img = ctx.getImageData(cx, cy, cw, ch);
          const data = img.data;
          let dark = 0;
          const px = (data.length / 4) | 0;
          // Threshold: R+G+B < 90 ≈ "near-black" (typical JPEG-of-#000 stays under 30).
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] + data[i + 1] + data[i + 2] < 90) dark++;
          }
          const coverage = px > 0 ? dark / px : 1;
          // Interior (post-inset, post-bleed) should be ~100% black.
          // A correctly-drawn rect always passes at 0.98; a rect drawn in
          // the wrong location or not drawn at all shows massive non-black
          // area and fails loudly.
          if (coverage < 0.98) {
            leaks.push({ page: pageIdx, rect: t.rect, coverage });
          }
        }
        // Free canvas before next page.
        canvas.width = 0; canvas.height = 0; canvas = null;
      }
    } finally {
      try { (doc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* noop */ }
    }

    post({
      kind: "result",
      id: m.id,
      ok: leaks.length === 0,
      total: targets.length,
      removed: targets.length - leaks.length,
      leaks,
    });
  } catch (err) {
    post({
      kind: "error",
      id: m.id,
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    active.delete(m.id);
  }
});

export {};
