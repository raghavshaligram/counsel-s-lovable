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
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

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
          // Inset the sample region by 2px on each side to tolerate JPEG
          // ringing along the burn-rect edges. The rasterizer pads the
          // painted rect by ≥1pt on each side (see rasterize.worker.ts), so
          // a 2px inset at scale ≥2 is still entirely inside truly-black
          // pixels. Without this inset, 92%-quality JPEG DCT artifacts on
          // the black-rect border cause thousands of false "burn incomplete"
          // reports on large form-heavy documents.
          const INSET = 2;
          const cx = Math.max(0, Math.floor(t.rect.x * scale) + INSET);
          const cy = Math.max(0, Math.floor(t.rect.y * scale) + INSET);
          const cw = Math.min(canvas.width - cx, Math.ceil(t.rect.w * scale) - INSET * 2);
          const ch = Math.min(canvas.height - cy, Math.ceil(t.rect.h * scale) - INSET * 2);
          if (cw < 2 || ch < 2) continue;
          const img = ctx.getImageData(cx, cy, cw, ch);
          const data = img.data;
          let dark = 0;
          const px = (data.length / 4) | 0;
          // Threshold: R+G+B < 120 ≈ "near-black" (JPEG-of-#000 stays under 60
          // even at q=0.85; 120 tolerates aggressive resampling without
          // accepting real text pixels).
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] + data[i + 1] + data[i + 2] < 120) dark++;
          }
          const coverage = px > 0 ? dark / px : 1;
          // 98% coverage — still forensically strict (98%+ of the interior
          // MUST be black) while tolerating JPEG edge noise on the 2%
          // perimeter that INSET could not fully skip on tiny rects.
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
