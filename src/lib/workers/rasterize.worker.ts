/// <reference lib="webworker" />
/**
 * Rasterize worker — burns black rectangles into redacted pages OFF the
 * main thread.
 *
 * Runs pdf.js render + pdf-lib page swap page-by-page inside a dedicated
 * worker. Frees the canvas and JPEG bytes after each page so peak memory
 * stays at ~1 page's bitmap regardless of document size. When the worker
 * finishes it is terminated by the main-thread client, releasing its
 * entire heap in one shot.
 */
import { PDFDocument } from "pdf-lib";
import { loadPdfjs } from "@/lib/pdf/worker";

export interface RectTL { x: number; y: number; w: number; h: number }

type InboundMsg =
  | {
      kind: "rasterize";
      id: string;
      bytes: ArrayBuffer;
      pageRedactions: Array<[number, RectTL[]]>;
      mode: "always" | "fallback";
      scale: number;
    }
  | { kind: "cancel"; id: string };

type OutboundMsg =
  | { kind: "progress"; id: string; done: number; total: number }
  | { kind: "result"; id: string; bytes: ArrayBuffer; rasterizedPages: number[] }
  | { kind: "error"; id: string; message: string };

const active = new Map<string, { canceled: boolean }>();

function post(msg: OutboundMsg, transfer?: Transferable[]) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

self.addEventListener("message", async (ev: MessageEvent<InboundMsg>) => {
  const m = ev.data;
  if (m.kind === "cancel") {
    const e = active.get(m.id);
    if (e) e.canceled = true;
    return;
  }
  if (m.kind !== "rasterize") return;

  const entry = { canceled: false };
  active.set(m.id, entry);

  try {
    const bytes = new Uint8Array(m.bytes);
    const pageRedactions = new Map<number, RectTL[]>(m.pageRedactions);
    const out = await rasterize(bytes, pageRedactions, m.mode, m.scale, (done, total) => {
      if (entry.canceled) return;
      post({ kind: "progress", id: m.id, done, total });
    }, () => entry.canceled);
    if (entry.canceled) throw new DOMException("Canceled", "AbortError");
    const outBuf = out.bytes.buffer as ArrayBuffer;
    post({ kind: "result", id: m.id, bytes: outBuf, rasterizedPages: out.rasterizedPages }, [outBuf]);
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

async function rasterize(
  bytes: Uint8Array,
  pageRedactions: Map<number, RectTL[]>,
  mode: "always" | "fallback",
  scale: number,
  onProgress: (done: number, total: number) => void,
  canceled: () => boolean,
): Promise<{ bytes: Uint8Array; rasterizedPages: number[] }> {
  if (pageRedactions.size === 0) return { bytes, rasterizedPages: [] };

  const outDoc = await PDFDocument.load(bytes);
  const pdfjs = await loadPdfjs();
  // In max-security mode the caller has transferred ownership of `bytes` to
  // this worker and no stage needs the raw buffer after pdf-lib has loaded it.
  // Hand that same buffer to pdf.js instead of allocating bytes.slice() — the
  // old full-file duplicate was enough to OOM 3000–5000 page exports.
  const srcData = mode === "fallback" ? bytes.slice() : bytes;
  const srcDoc = await pdfjs.getDocument({ data: srcData }).promise;
  const rasterizedPages: number[] = [];

  const pageOrder = Array.from(pageRedactions.keys()).sort((a, b) => b - a);
  let done = 0;
  const total = pageOrder.length;

  try {
    for (const pageIdx of pageOrder) {
      if (canceled()) throw new DOMException("Canceled", "AbortError");
      const rects = pageRedactions.get(pageIdx);
      if (!rects || !rects.length) continue;
      if (pageIdx < 0 || pageIdx >= srcDoc.numPages) continue;

      const page = await srcDoc.getPage(pageIdx + 1);
      const viewport1 = page.getViewport({ scale: 1 });
      const ph = viewport1.height;

      if (mode === "fallback") {
        const tc = await page.getTextContent();
        const hit = tc.items.some((it) => {
          if (!("str" in it)) return false;
          const item = it as { str: string; transform: number[]; width?: number; height?: number };
          if (!item.str || !item.str.trim()) return false;
          const t = item.transform;
          if (!t) return false;
          const fontH = Math.hypot(t[2], t[3]) || item.height || 1;
          const x = t[4];
          const yTop = ph - t[5];
          const w = Math.max(item.width ?? fontH * 0.5, 0.5);
          const r = { x, y: yTop, w, h: fontH };
          return rects.some((rr) => r.x < rr.x + rr.w && r.x + r.w > rr.x && r.y < rr.y + rr.h && r.y + r.h > rr.y);
        });
        if (!hit) {
          try { (page as unknown as { cleanup?: () => void }).cleanup?.(); } catch { /* noop */ }
          done++; onProgress(done, total);
          continue;
        }
      }

      const vp = page.getViewport({ scale });
      let canvas: OffscreenCanvas | null = new OffscreenCanvas(
        Math.max(1, Math.ceil(vp.width)),
        Math.max(1, Math.ceil(vp.height)),
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        try { (page as unknown as { cleanup?: () => void }).cleanup?.(); } catch { /* noop */ }
        throw new Error("OffscreenCanvas 2D context unavailable");
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport: vp,
        canvas: canvas as unknown as HTMLCanvasElement,
      } as unknown as Parameters<typeof page.render>[0]);
      await renderTask.promise;

      ctx.fillStyle = "#000000";
      for (const r of rects) {
        ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      }
      try { (page as unknown as { cleanup?: () => void }).cleanup?.(); } catch { /* noop */ }

      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      let jpegBytes: Uint8Array | null = new Uint8Array(await blob.arrayBuffer());

      // Free canvas immediately.
      canvas.width = 0; canvas.height = 0; canvas = null;

      const pages = outDoc.getPages();
      const existing = pages[pageIdx];
      if (existing) {
        const { width, height } = existing.getSize();
        const img = await outDoc.embedJpg(jpegBytes);
        outDoc.removePage(pageIdx);
        const newPage = outDoc.insertPage(pageIdx, [width, height]);
        newPage.drawImage(img, { x: 0, y: 0, width, height });
        rasterizedPages.push(pageIdx);
      }
      jpegBytes = null;

      done++; onProgress(done, total);
      // Yield so cancellation posts can be processed.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  } finally {
    try { (srcDoc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* noop */ }
  }

  if (rasterizedPages.length === 0) return { bytes, rasterizedPages: [] };
  const outBytes = await outDoc.save({ updateFieldAppearances: false });
  return { bytes: outBytes, rasterizedPages: rasterizedPages.slice().sort((a, b) => a - b) };
}

export {};
