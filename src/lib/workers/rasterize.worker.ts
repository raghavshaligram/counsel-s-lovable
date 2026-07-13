/// <reference lib="webworker" />
/**
 * Rasterize worker — burns black rectangles into redacted pages OFF the
 * main thread.
 *
 * Runs pdf.js render + pdf-lib fresh-document build page-by-page inside a
 * dedicated worker. Frees the canvas and JPEG bytes after each page so
 * peak memory stays at ~1 page's bitmap regardless of document size. When
 * the worker finishes it is terminated by the main-thread client,
 * releasing its entire heap in one shot.
 *
 * Fresh-document build (fix for 18 MB → 747 MB inflation):
 *   Previously we mutated the loaded PDFDocument via removePage/insertPage,
 *   which left every original Page dict + content stream + resources
 *   reachable from `/Outlines`, `/Names/Dests`, `/StructTreeRoot`, etc.
 *   pdf-lib has no GC on save, so those originals got re-serialized on top
 *   of the JPEG-per-page payload. We now build a fresh PDFDocument, copy
 *   only untouched pages via copyPages, and draw a single JPEG for each
 *   rasterized page. Outlines and cross-page link annotations targeting
 *   rasterized pages are intentionally dropped — that is the trade-off
 *   for breaking the retention chain.
 */
import { PDFDocument } from "pdf-lib";
import { loadPdfjs } from "@/lib/pdf/worker";
import { logHeap } from "@/lib/memory-log";

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

  const pdfjs = await loadPdfjs();
  const inputBytesMB = Math.round((bytes.byteLength / 1024 / 1024) * 10) / 10;
  logHeap("rasterize.worker start", {
    inputBytesMB,
    redactionPages: pageRedactions.size,
    mode,
    scale,
  });
  // pdf-lib holds subarray views into the source buffer for lazy stream
  // reads, so we cannot let pdf.js detach it. Give pdf.js its own slice.
  const srcPdfLib = await PDFDocument.load(bytes);
  const srcDoc: { numPages: number; getPage: (pageNumber: number) => Promise<any>; destroy?: () => Promise<void> } =
    await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const outDoc = await PDFDocument.create();

  // Preserve document metadata — a fresh PDFDocument.create() starts with
  // empty Info, and downstream (Bates, PDF/A) relies on these being set.
  try {
    const t = srcPdfLib.getTitle(); if (t) outDoc.setTitle(t);
    const a = srcPdfLib.getAuthor(); if (a) outDoc.setAuthor(a);
    const s = srcPdfLib.getSubject(); if (s) outDoc.setSubject(s);
    const k = srcPdfLib.getKeywords(); if (k) outDoc.setKeywords([k]);
    const cr = srcPdfLib.getCreator(); if (cr) outDoc.setCreator(cr);
    const pr = srcPdfLib.getProducer(); if (pr) outDoc.setProducer(pr);
    const cd = srcPdfLib.getCreationDate(); if (cd) outDoc.setCreationDate(cd);
    const md = srcPdfLib.getModificationDate(); if (md) outDoc.setModificationDate(md);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[rasterize] metadata copy failed (non-fatal)", err);
  }

  const totalPages = srcPdfLib.getPageCount();

  // Decide up front which pages will be rasterized. In "fallback" mode we
  // skip pages whose text-hit test misses every rect (content-stream
  // surgery already cleared them); in "always" mode every requested page
  // is rasterized.
  const toRasterize = new Set<number>();
  for (const pageIdx of pageRedactions.keys()) {
    if (pageIdx < 0 || pageIdx >= totalPages) continue;
    const rects = pageRedactions.get(pageIdx);
    if (!rects || !rects.length) continue;
    if (mode === "always") {
      toRasterize.add(pageIdx);
      continue;
    }
    // fallback: probe text before committing to rasterize.
    const page = await srcDoc.getPage(pageIdx + 1);
    const viewport1 = page.getViewport({ scale: 1 });
    const ph = viewport1.height;
    const tc = await page.getTextContent();
    const hit = (tc.items as unknown[]).some((it: unknown) => {
      if (typeof it !== "object" || it === null || !("str" in it)) return false;
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
    try { (page as unknown as { cleanup?: () => void }).cleanup?.(); } catch { /* noop */ }
    if (hit) toRasterize.add(pageIdx);
  }

  const rasterizedPages: number[] = [];
  let done = 0;
  const total = totalPages;

  try {
    // Single ascending pass over every page — rasterize or copy.
    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      if (canceled()) throw new DOMException("Canceled", "AbortError");

      if (!toRasterize.has(pageIdx)) {
        // Copy the untouched page from the source doc. copyPages carries
        // per-page resources (fonts, images) via pdf-lib's ref remap, so
        // this branch does NOT retain rasterized-page originals.
        try {
          const [copied] = await outDoc.copyPages(srcPdfLib, [pageIdx]);
          outDoc.addPage(copied);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[rasterize] copyPages failed for page — inserting blank placeholder", { pageIdx, err });
          const srcPage = srcPdfLib.getPage(pageIdx);
          const { width, height } = srcPage.getSize();
          outDoc.addPage([width, height]);
        }
        done++; onProgress(done, total);
        continue;
      }

      // Rasterize path.
      const page = await srcDoc.getPage(pageIdx + 1);
      const rects = pageRedactions.get(pageIdx)!;
      const vp = page.getViewport({ scale });
      let canvas: OffscreenCanvas | null = new OffscreenCanvas(
        Math.max(1, Math.ceil(vp.width)),
        Math.max(1, Math.ceil(vp.height)),
      );
      let ctx: OffscreenCanvasRenderingContext2D | null = canvas.getContext("2d");
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

      let blob: Blob | null = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      let jpegBuf: ArrayBuffer | null = await blob.arrayBuffer();
      blob = null;
      let jpegBytes: Uint8Array | null = new Uint8Array(jpegBuf);
      jpegBuf = null;

      // Free canvas + context immediately.
      canvas.width = 0; canvas.height = 0; canvas = null; ctx = null;

      const srcPage = srcPdfLib.getPage(pageIdx);
      const { width, height } = srcPage.getSize();
      const img = await outDoc.embedJpg(jpegBytes);
      const newPage = outDoc.addPage([width, height]);
      newPage.drawImage(img, { x: 0, y: 0, width, height });
      rasterizedPages.push(pageIdx);
      jpegBytes = null;

      done++; onProgress(done, total);
      // Yield so cancellation posts can be processed.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  } finally {
    // Destroy the pdf.js document immediately once page iteration is done —
    // releases its worker-side page cache before pdf-lib's save allocates
    // the output buffer.
    try { await (srcDoc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* noop */ }
  }

  // eslint-disable-next-line no-console
  console.info("[redact] rasterize summary", {
    mode,
    rasterizedPages: rasterizedPages.length,
    totalPages,
    redactionPages: pageRedactions.size,
  });

  if (rasterizedPages.length === 0 && toRasterize.size === 0) {
    // Nothing changed — return source bytes untouched.
    return { bytes, rasterizedPages: [] };
  }

  const outBytes = await outDoc.save({ updateFieldAppearances: false });
  logHeap("rasterize.worker end", {
    inputBytesMB,
    outputBytesMB: Math.round((outBytes.byteLength / 1024 / 1024) * 10) / 10,
    rasterizedPages: rasterizedPages.length,
  });
  return { bytes: outBytes, rasterizedPages: rasterizedPages.slice().sort((a, b) => a - b) };
}

export {};
